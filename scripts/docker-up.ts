// Sobe (ou derruba) o Expediente no Docker local. Roda no HOST, com tsx:
//
//   npm run docker:up                 # detecta as contas, gera o override, constrói e sobe
//   npm run docker:up -- --no-build   # sobe sem reconstruir a imagem
//   npm run docker:down               # derruba o container
//
// O que ele faz ao subir:
// 1. Descobre os config dirs do Claude Code no host (mesma regra do servidor: ~/.claude*,
//    CLAUDE_CONFIG_DIR ou EXPEDIENTE_CLAUDE_DIRS) e lê os metadados das contas com detectAccounts.
// 2. Gera o docker-compose.override.yml montando SOMENTE <conta>/projects e <conta>/sessions,
//    somente leitura, em /claude/<conta>/... — nunca a pasta inteira da conta, onde ficam
//    credenciais e configurações — e a ponte do mod (~/.expediente/host, criada se faltar) em /host,
//    também somente leitura. Passa EXPEDIENTE_CLAUDE_DIRS, EXPEDIENTE_ACCOUNTS, EXPEDIENTE_USAGE_DIR (/host/uso)
//    e o fuso do host (TZ) ao container.
//    Antes disso cria o token local (~/.expediente/host/token, modo 600) se ele não existir: sem ele o servidor
//    recusa toda escrita. Nunca sobrescreve o arquivo e nunca imprime o valor.
// 3. Roda `docker compose up -d --build`, espera o /api/health e mostra a URL.
//
// Uso de 5h/semanal ao vivo: o mod do Expediente (npm run instalar; Claude Code 2.1.287+) grava os números em
// ~/.expediente/host/uso, que o container lê em /host/uso. Sem ele, vale o cache do /usage lido das contas ao subir.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { AccountInfo, SourceInfo } from '../shared/types';
import { detectAccounts, discoverClaudeDirs, type DetectedAccount } from '../server/accounts/detect';
import { PUBLICACAO_ARQUIVO, planejarConfirmacao } from '../server/publicacao';
import { arquivoDoToken, garantirToken, lerToken } from '../server/token';
import { installDir, MIN_CLAUDE_VERSION } from './instalar';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.HOME || homedir();
const STATE_DIR = join(HOME, '.expediente');
const OVERRIDE_FILE = join(ROOT, 'docker-compose.override.yml');
/** O .env desta pasta, que o Compose lê sozinho. */
/** Ponte do mod no host: a única pasta fora das contas que o container monta. */
const HOST_DIR = join(STATE_DIR, 'host');
/** Onde a ponte aparece no container, e onde o servidor lê o uso ao vivo. */
const CONTAINER_HOST_DIR = '/host';
const CONTAINER_USAGE_DIR = `${CONTAINER_HOST_DIR}/uso`;
const SERVICE = 'expediente';
/** Raiz das montagens dentro do container: /claude/<conta>/{projects,sessions}. */
const CONTAINER_ROOT = '/claude';
/** Somente estas subpastas de cada conta entram no container. */
const MOUNTED_SUBDIRS = ['projects', 'sessions'] as const;
const DEFAULT_PORT = 4848;
const HEALTH_TIMEOUT_MS = 120_000;
const USAGE = `Uso: npm run docker:up [-- opções]

Opções:
  --no-build   sobe sem reconstruir a imagem
  --down       derruba o container (o mesmo que npm run docker:down)
  -h, --help   mostra esta ajuda

Variável: EXPEDIENTE_CLAUDE_DIRS
(config dirs separados por vírgula, se as contas não estiverem em ~/.claude*).`;

// ---------------------------------------------------------------------------------------------
// Saída no terminal
// ---------------------------------------------------------------------------------------------

const say = (msg: string) => console.log(`[docker-up] ${msg}`);
const warn = (msg: string) => console.warn(`[docker-up] Atenção: ${msg}`);

class FatalError extends Error {}

function fail(msg: string): never {
  throw new FatalError(msg);
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

const USAGE_STATUS: Record<AccountInfo['usageStatus'], string> = {
  ok: 'uso atualizado',
  stale: 'uso desatualizado',
  disabled: 'sem dados de uso',
};

// ---------------------------------------------------------------------------------------------
// Argumentos
// ---------------------------------------------------------------------------------------------

export interface Options {
  down: boolean;
  build: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): Options {
  const opts: Options = { down: false, build: true, help: false };
  for (const arg of argv) {
    if (arg === '--down') opts.down = true;
    else if (arg === '--no-build') opts.build = false;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else fail(`opção desconhecida: ${arg}\n\n${USAGE}`);
  }
  return opts;
}


// ---------------------------------------------------------------------------------------------
// Plano de montagens e override do Compose (funções puras, sem efeitos colaterais)
// ---------------------------------------------------------------------------------------------

export interface BindMount {
  /** Caminho real no host (symlinks resolvidos: o Docker Desktop não os segue). */
  source: string;
  /** Caminho dentro do container. */
  target: string;
}

export interface AccountMount {
  account: DetectedAccount;
  /** Config dir da conta no host. */
  hostDir: string;
  /** Onde a conta aparece no container: /claude/<id>. */
  mountDir: string;
  binds: BindMount[];
}

/** Janelas de uso que o servidor exibe (as demais chaves do cache são ignoradas). */
const USAGE_WINDOWS = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet'] as const;

type CachedWindow = { utilization: unknown; resets_at?: unknown };
type CachedUsage = { fetchedAtMs: unknown; utilization: Partial<Record<(typeof USAGE_WINDOWS)[number], CachedWindow>> };

export interface AccountPayload {
  id: string;
  configDir: string;
  mountDir: string;
  short: string;
  name: string;
  email?: string;
  organization?: string;
  plan?: string;
  color: string;
  cachedUsage?: CachedUsage;
}

/** Caminho real de uma pasta existente, ou undefined. */
function realDir(p: string): string | undefined {
  try {
    const real = realpathSync(p);
    return statSync(real).isDirectory() ? real : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Monta só projects/ e sessions/ de cada conta (as que existirem). `accounts` vem de
 * detectAccounts(dirs) e está na mesma ordem de `dirs`; o id (basename desambiguado) vira o
 * nome da pasta no container, então o servidor lá dentro deriva exatamente o mesmo id.
 */
export function planMounts(dirs: string[], accounts: DetectedAccount[], resolveDir: (p: string) => string | undefined = realDir): AccountMount[] {
  const out: AccountMount[] = [];
  dirs.forEach((hostDir, i) => {
    const account = accounts[i];
    const mountDir = posix.join(CONTAINER_ROOT, account.id);
    const binds: BindMount[] = [];
    for (const sub of MOUNTED_SUBDIRS) {
      const source = resolveDir(join(hostDir, sub));
      if (source) binds.push({ source, target: posix.join(mountDir, sub) });
    }
    if (binds.length) out.push({ account, hostDir, mountDir, binds });
  });
  return out;
}

/**
 * Do cache de uso do Claude Code (`cachedUsageUtilization`) só seguem a data da coleta e, de
 * cada janela exibida, o percentual e o horário de reinício. Identificadores da conta, gastos e
 * demais campos ficam de fora (o ambiente do container é visível em `docker inspect`).
 */
export function sanitizeCachedUsage(raw: unknown): CachedUsage | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const c = raw as Record<string, unknown>;
  const fetchedAtMs = c.fetchedAtMs ?? c.fetchedAt;
  if (fetchedAtMs === undefined || !c.utilization || typeof c.utilization !== 'object') return undefined;
  const util = c.utilization as Record<string, unknown>;
  const out: CachedUsage = { fetchedAtMs, utilization: {} };
  for (const key of USAGE_WINDOWS) {
    const w = util[key];
    if (!w || typeof w !== 'object') continue;
    const { utilization, resets_at } = w as Record<string, unknown>;
    if (utilization === undefined || utilization === null) continue;
    out.utilization[key] = resets_at === undefined || resets_at === null ? { utilization } : { utilization, resets_at };
  }
  return Object.keys(out.utilization).length ? out : undefined;
}

/** Metadados das contas para EXPEDIENTE_ACCOUNTS (o container não enxerga o .claude.json do host). */
export function accountsPayload(mounts: AccountMount[]): AccountPayload[] {
  return mounts.map(({ account: a, mountDir }) => {
    const p: AccountPayload = { id: a.id, configDir: a.configDir, mountDir, short: a.short, name: a.name, color: a.color };
    if (a.email) p.email = a.email;
    if (a.organization) p.organization = a.organization;
    if (a.plan) p.plan = a.plan;
    const cached = sanitizeCachedUsage(a.cachedUsage);
    if (cached) p.cachedUsage = cached;
    return p;
  });
}

/**
 * Escalar YAML seguro: string JSON (válida como string YAML entre aspas duplas) com `$`
 * duplicado, para o Compose não tentar interpolar variáveis dentro dos valores.
 */
export function yamlString(value: string): string {
  return JSON.stringify(value.replaceAll('$', '$$$$'));
}

/**
 * Fuso horário do host (TZ ou o do sistema), para o container: sem ele o Node do container usa UTC e
 * o "dia" do timelapse e do painel do dia viraria às 21h no horário de Brasília. Undefined se inválido.
 */
export function hostTimeZone(env: NodeJS.ProcessEnv = process.env): string | undefined {
  let tz = env.TZ?.trim().replace(/^:/, '');
  if (!tz) {
    try {
      tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return undefined;
    }
  }
  return tz && /^[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)*$/.test(tz) ? tz : undefined;
}

/**
 * `hostDir`: ponte do mod no host (já existente; caminho real), montada somente leitura em /host.
 * `timeZone`: fuso do host, repassado como TZ.
 */
export function renderOverride(mounts: AccountMount[], generatedAt: Date = new Date(), hostDir?: string, timeZone?: string): string {
  const env: Array<[string, string]> = [
    ['EXPEDIENTE_CLAUDE_DIRS', mounts.map((m) => m.mountDir).join(',')],
    ['EXPEDIENTE_ACCOUNTS', JSON.stringify(accountsPayload(mounts))],
  ];
  if (hostDir) env.push(['EXPEDIENTE_USAGE_DIR', CONTAINER_USAGE_DIR]);
  if (timeZone) env.push(['TZ', timeZone]);
  const lines = [
    `# Gerado por scripts/docker-up.ts em ${generatedAt.toISOString()} — não edite: é recriado a cada \`npm run docker:up\`.`,
    '# Contém caminhos do host e e-mails das contas: fica fora do git e com permissão 600.',
    '# Montagens: SOMENTE <conta>/projects, <conta>/sessions e ~/.expediente/host, todas somente leitura.',
    'services:',
    `  ${SERVICE}:`,
    '    environment:',
    ...env.map(([k, v]) => `      ${k}: ${yamlString(v)}`),
  ];
  const binds = mounts.flatMap((m) => m.binds);
  if (hostDir) binds.push({ source: hostDir, target: CONTAINER_HOST_DIR });
  if (binds.length) {
    lines.push('    volumes:');
    for (const b of binds) {
      lines.push(
        '      - type: bind',
        `        source: ${yamlString(b.source)}`,
        `        target: ${yamlString(b.target)}`,
        '        read_only: true',
        '        bind:',
        '          create_host_path: false',
      );
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * Dica do fim do docker:up sobre o mod: só aparece quando a cópia fixa do mod (npm run instalar) não existe.
 * Atualizar o mod é rodar o instalar de novo; o docker:up não mexe nas contas.
 */
export function modHint(installed: boolean): string[] {
  if (installed) return [];
  return [
    `  Uso de 5h/semanal ao vivo: npm run instalar (uma vez; Claude Code ${MIN_CLAUDE_VERSION}+). Sem ele, vale o cache do /usage.`,
  ];
}

// ---------------------------------------------------------------------------------------------
// Estado no host (~/.expediente)
// ---------------------------------------------------------------------------------------------

/** Cria a ponte do mod se faltar e devolve o caminho real (ou undefined, se falhar). */
function ensureHostDir(): string | undefined {
  try {
    mkdirSync(HOST_DIR, { recursive: true, mode: 0o700 });
    return realDir(HOST_DIR);
  } catch (err) {
    warn(`não consegui criar ${tildify(HOST_DIR)} (${(err as Error).message}); o container não vai ver o uso ao vivo.`);
    return undefined;
  }
}

export type EstadoDoToken = 'criado' | 'mantido' | 'invalido';

/** Cria o token local na ponte se faltar. Um arquivo que já existe fica como está, mesmo fora do formato. Nunca devolve o valor. */
export function prepararToken(hostDir: string): EstadoDoToken {
  const arquivo = arquivoDoToken(hostDir);
  if (garantirToken(arquivo)) return 'criado';
  return lerToken(arquivo).ok ? 'mantido' : 'invalido';
}

/** Grava o override com modo 600: ele tem caminhos do host e e-mails das contas. */
export function writeOverride(file: string, yml: string): void {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, yml, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
}

function tildify(p: string): string {
  return p === HOME || p.startsWith(`${HOME}/`) ? `~${p.slice(HOME.length)}` : p;
}

// ---------------------------------------------------------------------------------------------
// Docker
// ---------------------------------------------------------------------------------------------

function checkDocker(): void {
  const info = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], { encoding: 'utf8' });
  if (info.error) fail('o comando "docker" não foi encontrado. Instale o Docker Desktop: https://www.docker.com/products/docker-desktop/');
  if (info.status !== 0) fail('o Docker não está respondendo. Abra o Docker Desktop, espere ele terminar de iniciar e tente de novo.');
  const compose = spawnSync('docker', ['compose', 'version'], { encoding: 'utf8' });
  if (compose.status !== 0) fail('o Docker Compose v2 ("docker compose") não está disponível. Atualize o Docker Desktop.');
}

function compose(args: string[]): void {
  const res = spawnSync('docker', ['compose', ...args], { cwd: ROOT, stdio: 'inherit' });
  if (res.error) fail(`não consegui rodar "docker compose ${args.join(' ')}": ${res.error.message}`);
  if (res.status !== 0) fail(`"docker compose ${args.join(' ')}" falhou (código ${res.status ?? res.signal}).`);
}

/** `docker <args>` sem mostrar nada no terminal: se deu certo, a saída e a última linha do erro. */
function dockerQuiet(args: string[]): { ok: boolean; out: string; error: string } {
  const res = spawnSync('docker', args, { encoding: 'utf8' });
  // A última linha do docker costuma ser só "Run 'docker run --help' for more information".
  const lines = (res.stderr ?? '').split('\n').filter((l) => l.trim() && !/^Run '.*--help'/.test(l));
  const error = res.error?.message || lines.pop()?.trim() || `código ${res.status ?? res.signal}`;
  return { ok: res.status === 0, out: res.stdout ?? '', error };
}

/**
 * Confere com `docker inspect` que TODA porta publicada do container está em 127.0.0.1 e grava a confirmação em
 * /data/publicacao.json. Sem ela o servidor mantém terminal, histórico e permissões desligados.
 */
function confirmarPublicacao(): void {
  const file = `/data/${PUBLICACAO_ARQUIVO}`;
  const apagar = () => dockerQuiet(['exec', SERVICE, 'rm', '-f', file]);
  const inspect = dockerQuiet(['inspect', '--type', 'container', SERVICE]);
  let plano: ReturnType<typeof planejarConfirmacao>;
  try {
    if (!inspect.ok) throw new Error(inspect.error);
    plano = planejarConfirmacao((JSON.parse(inspect.out) as unknown[])[0]);
  } catch (err) {
    plano = { motivo: `não consegui ler o docker inspect (${(err as Error).message})` };
  }
  if ('motivo' in plano) {
    apagar();
    warn(`${plano.motivo}; terminal, histórico e permissões ficam desligados.`);
    return;
  }
  const grava = spawnSync('docker', ['exec', '-i', SERVICE, 'sh', '-c', `cat > ${file}.tmp && mv ${file}.tmp ${file}`], {
    input: JSON.stringify(plano.publicacao),
    encoding: 'utf8',
  });
  if (grava.status !== 0) {
    warn(`não consegui gravar ${file} no container (${(grava.stderr ?? '').trim() || grava.status}); terminal, histórico e permissões ficam desligados.`);
    return;
  }
  say(`Publicação confirmada só em 127.0.0.1 (${plano.publicacao.portas.map((p) => p.porta).join(', ')}): terminal, histórico e permissões ligados.`);
}

interface Health {
  ok: boolean;
  version?: string;
  demo?: boolean;
  docker?: boolean;
  sources?: SourceInfo[];
  accounts?: Array<{ id: string; usageStatus: AccountInfo['usageStatus'] }>;
}

async function fetchHealth(baseUrl: string, timeoutMs: number): Promise<Health | undefined> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Health;
    return body?.ok ? body : undefined;
  } catch {
    return undefined;
  }
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms));

async function waitHealthy(baseUrl: string): Promise<Health | undefined> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const health = await fetchHealth(baseUrl, 3_000);
    if (health) return health;
    await sleep(1_000);
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------------------------

function down(): void {
  checkDocker();
  say('Derrubando o container…');
  compose(['down']);
  say('Pronto. Os nomes dos personagens continuam guardados no volume expediente-data.');
}

async function up(opts: Options, port: number): Promise<void> {
  checkDocker();
  const baseUrl = `http://127.0.0.1:${port}`;
  const publicUrl = `http://localhost:${port}`;

  // Porta ocupada por um Expediente fora do Docker (npm run dev / npm start)?
  const existing = await fetchHealth(baseUrl, 1_500);
  if (existing && !existing.docker) {
    fail(
      `já existe um Expediente rodando fora do Docker em ${publicUrl} (npm run dev ou npm start?).\n` +
        `Pare-o antes de subir o container (a porta do Docker é sempre ${DEFAULT_PORT}).`,
    );
  }

  const dirs = discoverClaudeDirs(process.env, HOME);
  const accounts = detectAccounts(dirs, { home: HOME, env: process.env });
  const mounts = planMounts(dirs, accounts);
  if (!mounts.length) {
    warn(
      'nenhuma pasta do Claude Code (com projects/ ou sessions/) foi encontrada em ~/.claude*.\n' +
        '  O escritório vai abrir vazio (dá para ligar o modo demonstração na interface).\n' +
        '  Se as contas estiverem em outro lugar: EXPEDIENTE_CLAUDE_DIRS=/caminho/conta1,/caminho/conta2 npm run docker:up',
    );
  }
  for (const m of mounts) {
    const subdirs = m.binds.map((b) => posix.basename(b.target)).join(' e ');
    say(`Conta ${m.account.short} (${m.account.id}): monta ${subdirs} de ${tildify(m.hostDir)}, somente leitura.`);
  }
  for (const dir of dirs) {
    if (!mounts.some((m) => m.hostDir === dir)) warn(`${tildify(dir)} não tem projects/ nem sessions/; conta ignorada.`);
  }

  const hostDir = ensureHostDir();
  if (hostDir) say(`Ponte do mod: monta ${tildify(HOST_DIR)} em ${CONTAINER_HOST_DIR}, somente leitura.`);
  if (hostDir) {
    try {
      const token = prepararToken(hostDir);
      if (token === 'invalido') warn(`${tildify(arquivoDoToken(HOST_DIR))} existe mas não tem 64 caracteres hexadecimais; o servidor vai recusar toda escrita. Apague o arquivo e rode de novo para criar outro.`);
      else say(token === 'criado' ? `Token local criado em ${tildify(arquivoDoToken(HOST_DIR))} (modo 600).` : 'Token local já existia: mantido.');
    } catch (err) {
      warn(`não consegui criar o token local (${(err as Error).message}); o servidor vai recusar toda escrita.`);
    }
  }
  writeOverride(OVERRIDE_FILE, renderOverride(mounts, new Date(), hostDir, hostTimeZone()));
  say('docker-compose.override.yml gerado.');

  say(opts.build ? 'Construindo a imagem e subindo o container…' : 'Subindo o container (sem reconstruir a imagem)…');
  compose(opts.build ? ['up', '-d', '--build'] : ['up', '-d']);

  say(`Aguardando o Expediente responder em ${publicUrl}…`);
  const health = await waitHealthy(baseUrl);
  if (!health) fail(`o Expediente não respondeu em ${HEALTH_TIMEOUT_MS / 1000} s. Veja o que aconteceu com: npm run docker:logs`);

  confirmarPublicacao();

  console.log('');
  say(`Expediente${health.version ? ` ${health.version}` : ''} no ar: ${publicUrl}`);
  for (const acc of accounts) {
    const src = health.sources?.find((s) => s.label === acc.id);
    if (!src) continue;
    const usage = health.accounts?.find((a) => a.id === acc.id)?.usageStatus;
    const state = src.ok ? plural(src.sessions, 'sessão aberta', 'sessões abertas') : `erro ao ler (${src.error ?? 'desconhecido'})`;
    say(`  Conta ${acc.short} (${acc.id}): ${state}${usage ? ` · ${USAGE_STATUS[usage]}` : ''}`);
  }
  for (const line of modHint(existsSync(installDir(HOME)))) say(line);
  say('  Abrir o escritório já autorizado: npm run abrir');
  say('  Logs: npm run docker:logs · Parar: npm run docker:down');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(USAGE);
    return;
  }
  const port = DEFAULT_PORT;
  if (opts.down) down();
  else await up(opts, port);
}

// Executa só quando chamado direto (importar o módulo, ex. em testes, não sobe nada).
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    if (err instanceof FatalError) console.error(`[docker-up] Erro: ${err.message}`);
    else console.error('[docker-up] Erro inesperado:', err);
    process.exitCode = 1;
  });
}
