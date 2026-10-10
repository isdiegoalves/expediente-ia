// Instala (ou remove) o mod do Expediente no Claude Code de cada conta. Roda no HOST, com tsx:
//
//   npm run instalar          # cópia fixa do commit + marketplace "expediente" + plugin expediente
//   npm run desinstalar       # tira os plugins e o marketplace do Expediente de cada conta
//   npm run instalar:status   # commit instalado e, por conta, marketplace e plugins (e versões)
//   (opções: --commit <ref>, --com-permissoes, --conta <pasta>, --dry-run, --claude <comando>)
//
// Tudo passa pelo CLI do próprio Claude Code (`claude plugin ...`), rodado uma vez por conta com o CLAUDE_CONFIG_DIR
// daquela conta. Quem grava os registros (enabledPlugins e extraKnownMarketplaces no settings.json) é o Claude Code:
// este script nunca edita o settings.json de ninguém, e um teste estático impede que algum arquivo do repositório o faça.
//
// O marketplace NÃO é este checkout: o Claude Code lê o plugin no lugar, então cada troca de branch aqui passaria a
// rodar em todas as sessões das contas. O instalador exporta o commit pedido (--commit; padrão HEAD, recusando árvore
// com alterações) para uma cópia fixa e independente do repositório em ~/.expediente/mod-instalado, sem .git, e
// registra ESSA pasta: mover ou apagar o checkout não afeta o mod instalado. Atualizar o mod é rodar
// `npm run instalar` de novo (ou `npm run atualizar`, que puxa o repositório antes), de propósito.
//
// Nunca desinstala plugin do Habblaud, e recusa o expediente-permissoes numa conta em que o habblaud-permissoes
// esteja ativo (os dois responderiam o mesmo pedido).
//
// Status (e o plano de cada conta): vem de `claude plugin list --json` e `claude plugin marketplace list --json`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installedCommit, removeCopy, syncCopy, type GitRunner } from './copia-fixa';
import { discoverClaudeDirs, expandHome, isDefaultDir } from '../server/accounts/detect';

const DEFAULT_PORT = 4848;

function tildify(p: string, home: string): string {
  return p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

function formatAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h`;
  return `${Math.round(h / 24)} dias`;
}

/** Pasta do uso capturado (EXPEDIENTE_USAGE_DIR ou ~/.expediente/host/uso). */
function usageDirOf(env: NodeJS.ProcessEnv, home: string): string {
  const d = env.EXPEDIENTE_USAGE_DIR?.trim();
  return d ? resolve(d.replace(/^~(?=\/|$)/, home)) : join(home, '.expediente', 'host', 'uso');
}

/** Cópia fixa do commit instalado: é a pasta registrada como marketplace nas contas. */
export function installDir(home: string): string {
  return join(home, '.expediente', 'mod-instalado');
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Nome do marketplace em .claude-plugin/marketplace.json (contrato com mod/). */
export const MARKETPLACE = 'expediente';
/** O mod: uso do plano, aviso de "precisa de você" no terminal e /escritorio. */
export const MOD_PLUGIN = `expediente@${MARKETPLACE}`;
/** O hook PermissionRequest de responder pelo escritório, empacotado como plugin. */
export const PERMISSIONS_PLUGIN = `expediente-permissoes@${MARKETPLACE}`;
/** Primeira versão do Claude Code (terminal) que carrega mods. */
export const MIN_CLAUDE_VERSION = '2.1.287';
/** Os plugins vão sempre para o escopo do usuário: valem em todos os projetos da conta. */
const SCOPE = 'user';
/** Tempo máximo de cada chamada ao CLI (o add/update de um diretório local leva poucos segundos). */
const CLI_TIMEOUT_MS = 120_000;

const USAGE = `Uso: npm run <instalar|desinstalar|instalar:status> [-- opções]

  instalar          instala o mod do Expediente no Claude Code de cada conta, a partir de uma cópia fixa do commit
                    (~/.expediente/mod-instalado, independente deste checkout), só por \`claude plugin\`; o
                    settings.json das contas nunca é editado por este script. Rodar de novo atualiza a cópia e os
                    plugins; uma conta nova (pasta ~/.claude* com .claude.json) entra sozinha
  desinstalar       tira os plugins e o marketplace do Expediente de cada conta e remove a cópia fixa
  instalar:status   mostra o commit instalado e, por conta, o marketplace e os plugins (e versões)

Opções:
  --commit <ref>     commit a instalar (padrão: HEAD deste checkout, que precisa estar sem alterações versionadas)
  --com-permissoes   instala também o plugin de responder permissões pelo escritório (expediente-permissoes);
                     recusado na conta onde o habblaud-permissoes estiver ativo
  --conta <pasta>    só esta conta (ex.: --conta ~/.claude-conta2); pode repetir
  --dry-run          mostra o que faria, sem instalar nem gravar nada
  --claude <cmd>     comando do Claude Code (padrão: claude, do PATH)
  -h, --help         mostra esta ajuda

Precisa do Claude Code ${MIN_CLAUDE_VERSION} ou mais novo; em versões anteriores o instalador recusa a conta.
Antes de tocar nas contas, roda \`claude plugin validate --strict\` na cópia.

Contas: as do servidor (~/.claude* com projects/ ou sessions/, CLAUDE_CONFIG_DIR ou EXPEDIENTE_CLAUDE_DIRS) e as
~/.claude* com .claude.json (o Claude Code já rodou ali), mesmo sem sessão. Uso capturado em EXPEDIENTE_USAGE_DIR (padrão ~/.expediente/host/uso).`;

// ---------------------------------------------------------------------------------------------
// O CLI do Claude Code (injetável: os testes nunca chamam o de verdade)
// ---------------------------------------------------------------------------------------------

export interface ClaudeResult {
  /** Código de saída (null se nem chegou a rodar ou foi morto). */
  code: number | null;
  stdout: string;
  stderr: string;
  /** Falha ao iniciar o processo (ex.: `claude` fora do PATH). */
  error?: string;
}

/** Roda `claude <args>` com o ambiente dado (o CLAUDE_CONFIG_DIR da conta vem nele). */
export type ClaudeRunner = (args: string[], env: NodeJS.ProcessEnv) => ClaudeResult;

/** O runner de verdade. stdin fechado: nada fica esperando uma resposta no terminal. */
export function makeClaudeRunner(cmd = 'claude'): ClaudeRunner {
  return (args, env) => {
    const r = spawnSync(cmd, args, { env, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
    if (r.error) {
      const code = (r.error as NodeJS.ErrnoException).code;
      const error = code === 'ENOENT' ? `o comando "${cmd}" não foi encontrado no PATH` : code === 'ETIMEDOUT' ? `"${cmd} ${args.join(' ')}" não terminou em ${CLI_TIMEOUT_MS / 1000} s` : r.error.message;
      return { code: null, stdout: r.stdout ?? '', stderr: r.stderr ?? '', error };
    }
    return { code: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
}

/**
 * Ambiente do CLI para uma conta. A conta padrão (~/.claude) roda SEM CLAUDE_CONFIG_DIR, como o `claude` puro:
 * com a variável apontando para ~/.claude, o Claude Code passaria a usar ~/.claude/.claude.json em vez de
 * ~/.claude.json. E a variável herdada (ex.: rodando de dentro de uma sessão da outra conta) nunca vaza.
 */
export function accountEnv(env: NodeJS.ProcessEnv, dir: string, home: string): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env };
  if (isDefaultDir(dir, home)) delete out.CLAUDE_CONFIG_DIR;
  else out.CLAUDE_CONFIG_DIR = dir;
  return out;
}

// ---------------------------------------------------------------------------------------------
// Funções puras (testadas em server/test/instalar.test.ts)
// ---------------------------------------------------------------------------------------------

type Rec = Record<string, unknown>;

function rec(v: unknown): Rec | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined;
}

/** "2.1.293 (Claude Code)" → [2, 1, 293]. */
export function parseVersion(text: string): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

export function versionAtLeast(version: string, min: string): boolean {
  const a = parseVersion(version);
  const b = parseVersion(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
}

/** Sem códigos de cor do terminal. */
function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
}

/**
 * JSON da saída do CLI, com tolerância: a saída inteira, ou a partir da primeira linha que abre um JSON (avisos
 * antes dele), ou só a última linha (formato de resultado do `--json` das ações). undefined se nada servir.
 */
export function parseJsonOutput(stdout: string): unknown {
  const text = stripAnsi(stdout).trim();
  if (!text) return undefined;
  const tryParse = (s: string): unknown => {
    try {
      return JSON.parse(s) as unknown;
    } catch {
      return undefined;
    }
  };
  const whole = tryParse(text);
  if (whole !== undefined) return whole;
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => /^\s*[[{]/.test(l));
  if (start > 0) {
    const fromStart = tryParse(lines.slice(start).join('\n'));
    if (fromStart !== undefined) return fromStart;
  }
  return tryParse(lines[lines.length - 1]);
}

/** Uma instalação de plugin, como `claude plugin list --json` mostra (só o que usamos). */
export interface PluginInfo {
  id: string;
  version?: string;
  scope?: string;
  enabled: boolean;
  /** Pasta de onde carrega, quando lido no lugar a partir de um marketplace local (Claude Code 2.1.289+). */
  readFromFolder?: string;
  /** Versão do manifesto nessa pasta (pode ser mais nova que a registrada). */
  folderVersion?: string;
  errors: string[];
}

/** Lista de plugins instalados; aceita o array ou o objeto de `--available` ({installed: [...]}). */
export function parsePluginList(stdout: string): PluginInfo[] | undefined {
  const raw = parseJsonOutput(stdout);
  const list = Array.isArray(raw) ? raw : rec(raw) && Array.isArray(rec(raw)!.installed) ? (rec(raw)!.installed as unknown[]) : undefined;
  if (!list) return undefined;
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const out: PluginInfo[] = [];
  for (const item of list) {
    const r = rec(item);
    const id = str(r?.id);
    if (!r || !id) continue;
    out.push({
      id,
      version: str(r.version),
      scope: str(r.scope),
      enabled: r.enabled !== false,
      readFromFolder: str(r.readFromFolder),
      folderVersion: str(r.folderVersion),
      errors: Array.isArray(r.errors) ? r.errors.filter((e): e is string => typeof e === 'string') : [],
    });
  }
  return out;
}

export interface MarketplaceInfo {
  name: string;
  source?: string;
  /** Pasta (marketplaces de diretório ou arquivo local). */
  path?: string;
}

export function parseMarketplaceList(stdout: string): MarketplaceInfo[] | undefined {
  const raw = parseJsonOutput(stdout);
  if (!Array.isArray(raw)) return undefined;
  const out: MarketplaceInfo[] = [];
  for (const item of raw) {
    const r = rec(item);
    if (!r || typeof r.name !== 'string') continue;
    const m: MarketplaceInfo = { name: r.name };
    if (typeof r.source === 'string') m.source = r.source;
    const path = typeof r.path === 'string' ? r.path : typeof r.installLocation === 'string' && r.source === 'directory' ? r.installLocation : undefined;
    if (path) m.path = path;
    out.push(m);
  }
  return out;
}

/** O que uma conta tem do Expediente no Claude Code. */
export interface AccountState {
  marketplace?: MarketplaceInfo;
  plugins: PluginInfo[];
}

/** A instalação de `id` no escopo do usuário (o único que este script gerencia). */
export function userInstall(state: AccountState, id: string): PluginInfo | undefined {
  return state.plugins.find((p) => p.id === id && (p.scope === SCOPE || p.scope === undefined));
}

/** Uma chamada ao CLI, com a frase que conta o que ela faz. */
export interface CliStep {
  args: string[];
  /** "expediente: instalado" (vira ✓, ~ ou ✗ na saída). */
  message: string;
  /** Plugin que depende deste passo (falhou = não conta como instalado). */
  plugin?: string;
}

/** Item do plano, na ordem da saída: uma chamada ao CLI ou algo que já está certo (vira "="). */
export type PlanItem = CliStep | { unchanged: string };

export interface InstallPlan {
  items: PlanItem[];
  /** Avisos que não impedem a instalação. */
  notes: string[];
  /** Plugins que ficam instalados se todos os passos derem certo. */
  plugins: string[];
  /** Pedidos recusados (contam como falha da conta). */
  refusals: string[];
}

/** Só as chamadas ao CLI de um plano. */
export function cliSteps(plan: InstallPlan): CliStep[] {
  return plan.items.filter((i): i is CliStep => 'args' in i);
}

export interface PlanOptions {
  /** Raiz do repositório (onde está .claude-plugin/marketplace.json). */
  root: string;
  /** Versão do package.json (= versão dos plugins). */
  version: string;
  /** Instalar também o plugin de permissões. */
  permissions: boolean;
  /** Compara pastas (padrão: caminho real). */
  sameDir?: (a: string, b: string) => boolean;
}

/** Mesma pasta, resolvendo symlinks quando der. */
export function sameDir(a: string, b: string): boolean {
  if (resolve(a) === resolve(b)) return true;
  const real = (p: string) => {
    try {
      return realpathSync(p);
    } catch {
      return resolve(p);
    }
  };
  return real(a) === real(b);
}

/** O plugin de permissões do Habblaud: dois hooks PermissionRequest responderiam o mesmo pedido. */
const HABBLAUD_PERMISSIONS = 'habblaud-permissoes@';

export function habblaudPermissionsActive(state: AccountState): PluginInfo | undefined {
  return state.plugins.find((p) => p.id.startsWith(HABBLAUD_PERMISSIONS) && p.enabled);
}

const shortName = (id: string) => id.split('@')[0];

/**
 * Passos de instalação de uma conta, a partir do que ela já tem. O
 * marketplace é adicionado (ou, se já existe, tem o catálogo relido; se apontava para outra pasta, passa a
 * apontar para esta). Cada plugin é instalado, religado (se estava desligado) ou atualizado (se a versão
 * registrada difere da do package.json).
 */
export function planInstall(state: AccountState, o: PlanOptions): InstallPlan {
  const same = o.sameDir ?? sameDir;
  const plan: InstallPlan = { items: [], notes: [], plugins: [], refusals: [] };
  const m = state.marketplace;
  if (!m) {
    plan.items.push({ args: ['plugin', 'marketplace', 'add', o.root], message: `marketplace ${MARKETPLACE}: adicionado (esta pasta)` });
  } else if (m.path && same(m.path, o.root)) {
    plan.items.push({ args: ['plugin', 'marketplace', 'update', MARKETPLACE], message: `marketplace ${MARKETPLACE}: catálogo relido desta pasta` });
  } else {
    // Outra pasta (o Expediente mudou de lugar) ou outra origem: o add com a mesma chave só troca a origem e
    // mantém os plugins instalados.
    plan.items.push({
      args: ['plugin', 'marketplace', 'add', o.root],
      message: `marketplace ${MARKETPLACE}: passou a apontar para esta pasta (antes: ${m.path ?? m.source ?? 'outra origem'})`,
    });
  }
  const habblaud = o.permissions ? habblaudPermissionsActive(state) : undefined;
  if (habblaud) {
    plan.refusals.push(
      `${shortName(PERMISSIONS_PLUGIN)} recusado: ${habblaud.id} está ativo nesta conta e os dois responderiam o mesmo pedido de permissão. Desligue o do Habblaud por conta (claude plugin disable ${habblaud.id}) e rode de novo.`,
    );
  }
  const wanted = o.permissions && !habblaud ? [MOD_PLUGIN, PERMISSIONS_PLUGIN] : [MOD_PLUGIN];
  for (const id of wanted) {
    const name = shortName(id);
    const cur = userInstall(state, id);
    if (!cur) {
      plan.items.push({ args: ['plugin', 'install', id, '--scope', SCOPE], message: `${name}: instalado`, plugin: id });
      plan.plugins.push(id);
      continue;
    }
    plan.plugins.push(id);
    let touched = false;
    if (!cur.enabled) {
      plan.items.push({ args: ['plugin', 'enable', id, '--scope', SCOPE], message: `${name}: religado (estava desligado)`, plugin: id });
      touched = true;
    }
    if (cur.version !== o.version) {
      plan.items.push({ args: ['plugin', 'update', id, '--scope', SCOPE], message: `${name}: atualizado de ${cur.version ?? '?'} para ${o.version}`, plugin: id });
      touched = true;
    }
    if (!touched) plan.items.push({ unchanged: `${name}: já instalado na versão ${o.version}` });
  }
  // Sem --com-permissoes, um plugin de permissões já instalado continua (e acompanha a versão do mod).
  const perm = !o.permissions || habblaud ? userInstall(state, PERMISSIONS_PLUGIN) : undefined;
  if (perm) {
    if (perm.version !== o.version) {
      plan.items.push({
        args: ['plugin', 'update', PERMISSIONS_PLUGIN, '--scope', SCOPE],
        message: `${shortName(PERMISSIONS_PLUGIN)}: atualizado de ${perm.version ?? '?'} para ${o.version}`,
        plugin: PERMISSIONS_PLUGIN,
      });
    }
    plan.plugins.push(PERMISSIONS_PLUGIN);
    plan.notes.push(
      `${shortName(PERMISSIONS_PLUGIN)} já estava instalado e continua (sem --com-permissoes ele não é removido; para tirar: claude plugin uninstall ${PERMISSIONS_PLUGIN})`,
    );
  }
  return plan;
}

/**
 * Passos de remoção: os plugins do escopo do usuário e o marketplace, só o
 * que existir. (Tirar o marketplace já desinstalaria o que veio dele, mas um passo por plugin deixa claro, na
 * saída, o que saiu.)
 */
export function planUninstall(state: AccountState): InstallPlan {
  const plan: InstallPlan = { items: [], notes: [], plugins: [], refusals: [] };
  for (const id of [MOD_PLUGIN, PERMISSIONS_PLUGIN]) {
    const name = shortName(id);
    if (userInstall(state, id)) plan.items.push({ args: ['plugin', 'uninstall', id, '--scope', SCOPE], message: `${name}: removido`, plugin: id });
    else plan.items.push({ unchanged: `${name}: não estava instalado` });
  }
  if (state.marketplace) plan.items.push({ args: ['plugin', 'marketplace', 'remove', MARKETPLACE], message: `marketplace ${MARKETPLACE}: removido` });
  else plan.items.push({ unchanged: `marketplace ${MARKETPLACE}: não estava adicionado` });
  return plan;
}

/** Diferenças entre o que deveria ter ficado instalado e o que o Claude Code registra depois dos passos. */
export function verifyInstall(after: AccountState, plugins: string[], version: string): string[] {
  const out: string[] = [];
  for (const id of plugins) {
    const p = userInstall(after, id);
    const name = shortName(id);
    if (!p) out.push(`${name}: não aparece instalado na lista do Claude Code`);
    else if (!p.enabled) out.push(`${name}: instalado, mas desligado (claude plugin enable ${id})`);
    else if (p.version !== version) out.push(`${name}: o Claude Code registra a versão ${p.version ?? '?'}, não a ${version} (o manifesto em mod/ está com outra versão?)`);
    if (p?.errors.length) out.push(`${name}: ${p.errors.join('; ')}`);
  }
  return out;
}

/** Últimas linhas úteis da saída do CLI (para explicar uma falha). */
export function cliMessage(r: ClaudeResult): string {
  if (r.error) return r.error;
  const lines = stripAnsi(`${r.stdout}\n${r.stderr}`)
    .split(/\r?\n/)
    .map((l) => l.replace(/^[\s✘✔✗✓×]+/, '').trim())
    .filter(Boolean);
  return lines.slice(-2).join(' · ') || `saiu com código ${r.code ?? '?'}`;
}

/** Linhas do status de uma conta (sem o cabeçalho). */
export function describeStatus(state: AccountState, o: { root: string; version?: string; home: string; sameDir?: (a: string, b: string) => boolean }): string[] {
  const same = o.sameDir ?? sameDir;
  const lines: string[] = [];
  const m = state.marketplace;
  if (!m) lines.push(`marketplace ${MARKETPLACE}: não adicionado`);
  else if (m.path && same(m.path, o.root)) lines.push(`marketplace ${MARKETPLACE}: cópia fixa em ${tildify(o.root, o.home)}`);
  else lines.push(`marketplace ${MARKETPLACE}: outra origem (${m.path ? tildify(m.path, o.home) : (m.source ?? '?')}); npm run instalar aponta para a cópia fixa`);
  for (const id of [MOD_PLUGIN, PERMISSIONS_PLUGIN]) {
    const name = shortName(id);
    const all = state.plugins.filter((p) => p.id === id);
    if (!all.length) {
      lines.push(`${name}: não instalado`);
      continue;
    }
    for (const p of all) {
      const parts = [`instalado${p.scope && p.scope !== SCOPE ? ` (escopo ${p.scope})` : ''}`, p.enabled ? 'ligado' : 'desligado'];
      parts.push(`versão ${p.version ?? '?'}${!o.version || p.version === o.version ? '' : ` (a cópia fixa tem ${o.version}; npm run instalar atualiza)`}`);
      if (p.folderVersion && p.folderVersion !== p.version) parts.push(`carrega ${p.folderVersion} de ${tildify(p.readFromFolder ?? '?', o.home)}`);
      if (p.errors.length) parts.push(`erro: ${p.errors.join('; ')}`);
      lines.push(`${name}: ${parts.join(', ')}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------------------------------------
// Efeitos (CLI do Claude Code)
// ---------------------------------------------------------------------------------------------

export interface RunOptions {
  command: 'install' | 'uninstall' | 'status';
  dryRun: boolean;
  /** true com --com-permissoes. */
  permissions: boolean;
  /** --conta (vazio = todas as detectadas). */
  accounts: string[];
  claudeCmd?: string;
  /** --commit: o que instalar (padrão: HEAD do checkout). */
  commit?: string;
}

export interface RunContext {
  env: NodeJS.ProcessEnv;
  home: string;
  now: Date;
  /** Raiz do checkout (de onde sai a cópia fixa). */
  root: string;
  claude: ClaudeRunner;
  git: GitRunner;
  out: (line: string) => void;
  /** Consulta o /api/health do Expediente no status (testes injetam um falso). */
  health?: (port: number) => Promise<{ permissions?: boolean } | undefined>;
}

class FatalError extends Error {}

export function makeGitRunner(): GitRunner {
  return (args, cwd) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: CLI_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: r.status, stdout: (r.stdout ?? '').trim(), stderr: (r.stderr ?? '').trim() || (r.error?.message ?? '') };
  };
}

/** Commit a instalar: o --commit, ou o HEAD (que precisa estar sem alterações nos arquivos versionados). */
export function resolveCommit(git: GitRunner, root: string, ref: string | undefined): { commit: string } | { error: string } {
  if (!ref) {
    const st = git(['status', '--porcelain', '--untracked-files=no'], root);
    if (st.code !== 0) return { error: `não consegui conferir o checkout (${st.stderr || 'git falhou'})` };
    if (st.stdout) return { error: 'o checkout tem alterações não commitadas nos arquivos versionados; commite ou use --commit <ref>.' };
  }
  const rp = git(['rev-parse', '--verify', `${ref ?? 'HEAD'}^{commit}`], root);
  if (rp.code !== 0) return { error: `não achei o commit ${ref ?? 'HEAD'} (${rp.stderr || 'git falhou'})` };
  const commit = rp.stdout;
  const nameAt = (file: string): string | undefined => {
    const r = git(['show', `${commit}:${file}`], root);
    if (r.code !== 0) return undefined;
    try {
      return (JSON.parse(r.stdout) as { name?: unknown }).name as string | undefined;
    } catch {
      return undefined;
    }
  };
  const plugin = 'mod/expediente/.claude-plugin/plugin.json';
  if (nameAt(plugin) !== MARKETPLACE) {
    return { error: `o commit ${commit.slice(0, 7)} não tem ${plugin} com "name": "${MARKETPLACE}" (anterior ao fork?); a cópia fixa sairia com o mod errado.` };
  }
  if (nameAt('.claude-plugin/marketplace.json') !== MARKETPLACE) {
    return { error: `o commit ${commit.slice(0, 7)} não tem .claude-plugin/marketplace.json do marketplace "${MARKETPLACE}"; a cópia fixa sairia com o mod errado.` };
  }
  return { commit };
}

/**
 * Contas onde instalar: as do servidor mais as ~/.claude* com .claude.json (o Claude Code já rodou ali), para a conta
 * criada há pouco (ainda sem sessão) entrar sem outro passo. EXPEDIENTE_CLAUDE_DIRS manda sozinho, como no servidor.
 */
export function discoverInstallDirs(env: NodeJS.ProcessEnv, home: string): string[] {
  const found = discoverClaudeDirs(env, home);
  if (env.EXPEDIENTE_CLAUDE_DIRS?.trim()) return found;
  const extra: string[] = [];
  try {
    for (const ent of readdirSync(home, { withFileTypes: true })) {
      if (!ent.name.startsWith('.claude') || !(ent.isDirectory() || ent.isSymbolicLink())) continue;
      const p = join(home, ent.name);
      if (found.includes(p) || !existsSync(join(p, '.claude.json'))) continue;
      extra.push(p);
    }
  } catch {
    // $HOME ilegível: fica só com as do servidor
  }
  return [...found, ...extra].sort((a, b) => Number(!isDefaultDir(a, home)) - Number(!isDefaultDir(b, home)) || a.localeCompare(b));
}

async function fetchHealth(port: number): Promise<{ permissions?: boolean } | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_500) });
    if (!res.ok) return undefined;
    return (await res.json()) as { permissions?: boolean };
  } catch {
    return undefined;
  }
}

/** Porta do Expediente (EXPEDIENTE_PORT ou a padrão). */
function expedientePort(env: NodeJS.ProcessEnv): number {
  const p = Number.parseInt(env.EXPEDIENTE_PORT ?? '', 10);
  return Number.isInteger(p) && p > 0 && p < 65_536 ? p : DEFAULT_PORT;
}

export function parseArgs(argv: string[]): RunOptions | 'help' {
  let command: RunOptions['command'] | undefined;
  let dryRun = false;
  let permissions = false;
  let claudeCmd: string | undefined;
  let commit: string | undefined;
  const accounts: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return 'help';
    if (a === '--dry-run') dryRun = true;
    else if (a === '--com-permissoes') permissions = true;
    else if (a === '--conta') {
      const dir = argv[++i];
      if (!dir) throw new FatalError('--conta precisa da pasta da conta (ex.: --conta ~/.claude-conta2).');
      accounts.push(dir);
    } else if (a === '--claude') {
      claudeCmd = argv[++i];
      if (!claudeCmd) throw new FatalError('--claude precisa de um comando ou caminho.');
    } else if (a === '--commit') {
      commit = argv[++i];
      if (!commit) throw new FatalError('--commit precisa de um commit ou ref.');
    } else if ((a === 'install' || a === 'uninstall' || a === 'status') && !command) command = a;
    else throw new FatalError(`opção desconhecida: ${a}\n\n${USAGE}`);
  }
  if (!command) throw new FatalError(`diga o que fazer: install, uninstall ou status.\n\n${USAGE}`);
  return { command, dryRun, permissions, accounts, claudeCmd, commit };
}

/** Versão do package.json da raiz. */
export function readPackageVersion(root: string): string {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version?: unknown };
  if (typeof pkg.version !== 'string' || !pkg.version) throw new FatalError(`package.json sem "version" em ${root}`);
  return pkg.version;
}

/** Marketplace e plugins de uma conta, pelo CLI (ou o motivo de não conseguir). */
export function readAccountState(claude: ClaudeRunner, env: NodeJS.ProcessEnv): AccountState | { error: string } {
  const mr = claude(['plugin', 'marketplace', 'list', '--json'], env);
  if (mr.error || mr.code !== 0) return { error: `não consegui listar os marketplaces (${cliMessage(mr)})` };
  const markets = parseMarketplaceList(mr.stdout);
  if (!markets) return { error: 'não entendi a lista de marketplaces do Claude Code' };
  const pr = claude(['plugin', 'list', '--json'], env);
  if (pr.error || pr.code !== 0) return { error: `não consegui listar os plugins (${cliMessage(pr)})` };
  const plugins = parsePluginList(pr.stdout);
  if (!plugins) return { error: 'não entendi a lista de plugins do Claude Code' };
  return { marketplace: markets.find((m) => m.name === MARKETPLACE), plugins };
}

/** Pastas das contas: as de --conta (que precisam existir) ou as detectadas. */
function accountDirs(opts: RunOptions, env: NodeJS.ProcessEnv, home: string): string[] {
  if (!opts.accounts.length) return discoverInstallDirs(env, home);
  return [...new Set(opts.accounts.map((a) => expandHome(a, home)))].map((dir) => {
    let ok = false;
    try {
      ok = statSync(dir).isDirectory();
    } catch {
      ok = false;
    }
    if (!ok) throw new FatalError(`--conta ${dir}: pasta não encontrada.`);
    return dir;
  });
}

/** Último uso capturado (pelo mod ou pelo tap) de uma conta, para o status. */
function lastCapture(dir: string, env: NodeJS.ProcessEnv, home: string, now: Date): string {
  const file = join(usageDirOf(env, home), `${basename(dir)}.json`);
  try {
    const j = JSON.parse(readFileSync(file, 'utf8')) as Rec;
    const at = typeof j.fetchedAt === 'number' ? j.fetchedAt : statSync(file).mtimeMs;
    return `último uso capturado há ${formatAge(now.getTime() - at)} (${j.source === 'mod' ? 'pelo mod' : 'pelo tap de statusline'})`;
  } catch {
    return 'nenhum uso capturado ainda (chega depois da próxima resposta numa sessão aberta desta conta)';
  }
}

/** Executa o comando para todas as contas. Devolve o código de saída. */
export async function run(opts: RunOptions, ctx: RunContext): Promise<number> {
  const { env, home, out } = ctx;
  const dirs = accountDirs(opts, env, home);
  if (!dirs.length) {
    out('Nenhuma conta do Claude Code encontrada (~/.claude* com projects/ ou sessions/). Use --conta <pasta> ou EXPEDIENTE_CLAUDE_DIRS.');
    return 1;
  }
  const manifest = join(ctx.root, '.claude-plugin', 'marketplace.json');
  if (opts.command === 'install' && !existsSync(manifest)) {
    out(`Não achei ${tildify(manifest, home)}: este checkout não tem o mod.`);
    return 1;
  }

  // Uma versão só: todas as contas usam o mesmo executável, só muda o CLAUDE_CONFIG_DIR.
  const vr = ctx.claude(['--version'], env);
  if (vr.error) {
    out(`Não consegui rodar o Claude Code: ${vr.error}.`);
    out('Instale o Claude Code (https://code.claude.com) ou diga onde ele está: npm run instalar -- --claude <caminho>');
    return 1;
  }
  const cliVersion = parseVersion(vr.stdout) ? parseVersion(vr.stdout)!.join('.') : undefined;
  if (opts.command === 'install') {
    if (!cliVersion) {
      out(`Não entendi a versão do Claude Code ("${cliMessage(vr)}"); não instalo sem conferir que ela tem ${MIN_CLAUDE_VERSION} ou mais.`);
      return 1;
    } else if (!versionAtLeast(cliVersion, MIN_CLAUDE_VERSION)) {
      out(`O mod precisa do Claude Code ${MIN_CLAUDE_VERSION} ou mais novo, e este é o ${cliVersion}.`);
      out('Atualize o Claude Code (claude update) e rode de novo.');
      return 1;
    }
  }
  const copy = installDir(home);
  let version: string | undefined;
  if (opts.command === 'install') {
    const target = resolveCommit(ctx.git, ctx.root, opts.commit);
    if ('error' in target) {
      out(target.error);
      return 1;
    }
    if (opts.dryRun) out(`~ cópia fixa em ${tildify(copy, home)} no commit ${target.commit.slice(0, 7)} (simulação: nada criado)`);
    else {
      const bad = syncCopy(ctx.git, ctx.root, copy, target.commit);
      if (bad) {
        out(bad);
        return 1;
      }
      out(`✓ cópia fixa em ${tildify(copy, home)} no commit ${target.commit.slice(0, 7)}`);
    }
    const vv = ctx.claude(['plugin', 'validate', opts.dryRun ? ctx.root : copy, '--strict'], env);
    if (vv.error || vv.code !== 0) {
      out(`O marketplace não passou em claude plugin validate --strict (${cliMessage(vv)}); nenhuma conta foi tocada.`);
      return 1;
    }
    version = opts.dryRun ? readPackageVersion(ctx.root) : readPackageVersion(copy);
  }
  if (opts.command === 'status') {
    const head = ctx.git(['rev-parse', 'HEAD'], ctx.root);
    const inst = installedCommit(copy);
    if (inst) version = existsSync(join(copy, 'package.json')) ? readPackageVersion(copy) : undefined;
    out(`Claude Code ${cliVersion ?? '(versão desconhecida)'}${cliVersion && !versionAtLeast(cliVersion, MIN_CLAUDE_VERSION) ? ` — o mod precisa do ${MIN_CLAUDE_VERSION}+` : ''}`);
    if (inst) {
      const igual = head.code === 0 && head.stdout === inst;
      out(`commit instalado: ${inst.slice(0, 7)} em ${tildify(copy, home)}${igual ? '' : ` (o checkout está em ${head.code === 0 ? head.stdout.slice(0, 7) : '?'}; npm run instalar atualiza)`}`);
    } else out(`commit instalado: nenhum (a cópia fixa ${tildify(copy, home)} não existe; npm run instalar cria)`);
  }

  // O mod grava o uso em ~/.expediente/host/uso, mas não cria a pasta (o docker:up monta ~/.expediente/host no container).
  if (opts.command === 'install' && !opts.dryRun) {
    const usageDir = usageDirOf(env, home);
    try {
      if (!existsSync(usageDir)) {
        mkdirSync(usageDir, { recursive: true, mode: 0o700 });
        out(`✓ pasta do uso criada: ${tildify(usageDir, home)}`);
      }
    } catch (err) {
      out(`! não consegui criar ${tildify(usageDir, home)} (${(err as Error).message}); o uso ao vivo não vai ser gravado`);
    }
  }

  let failures = 0;
  let changed = 0;
  for (const dir of dirs) {
    const label = `${basename(dir)} (${tildify(dir, home)})`;
    const cenv = accountEnv(env, dir, home);
    const state = readAccountState(ctx.claude, cenv);
    if (opts.command === 'status') {
      out(`• ${label}`);
      if ('error' in state) {
        out(`    ✗ ${state.error}`);
        failures++;
      } else for (const l of describeStatus(state, { root: copy, version, home })) out(`    ${l}`);
      out(`    ${lastCapture(dir, env, home, ctx.now)}`);
      continue;
    }

    out(`${label}:`);
    if ('error' in state) {
      out(`  ✗ ${state.error}`);
      failures++;
      continue;
    }
    const plan = opts.command === 'install' ? planInstall(state, { root: copy, version: version!, permissions: opts.permissions }) : planUninstall(state);
    for (const r of plan.refusals) {
      out(`  ✗ ${r}`);
      failures++;
    }
    const failed = new Set<string>();
    let broken = false;
    let stepFailed = false;
    for (const item of plan.items) {
      if (!('args' in item)) {
        out(`  = ${item.unchanged}`);
        continue;
      }
      if (opts.dryRun) {
        out(`  ~ ${item.message} (simulação: claude ${item.args.join(' ')})`);
        continue;
      }
      // Na instalação, depois de uma falha os passos seguintes desta conta não rodam (sem marketplace não há
      // plugin). Na remoção, segue: o que der para tirar, sai.
      if (broken && opts.command === 'install') {
        if (item.plugin) failed.add(item.plugin);
        continue;
      }
      if (item.args[1] === 'uninstall' && /habblaud/i.test(item.args.join(' '))) throw new FatalError(`recusei rodar claude ${item.args.join(' ')}: plugin do Habblaud não é do Expediente.`);
      const r = ctx.claude(item.args, cenv);
      if (!r.error && r.code === 0) {
        out(`  ✓ ${item.message}`);
        changed++;
      } else {
        out(`  ✗ ${item.message.split(':')[0]}: falhou (${cliMessage(r)})`);
        if (item.plugin) failed.add(item.plugin);
        stepFailed = true;
        broken = true;
      }
    }
    if (stepFailed) failures++;
    for (const n of plan.notes) out(`  ! ${n}`);
    if (opts.command !== 'install') continue;

    // Confere com o próprio Claude Code o que ficou instalado (um update sem efeito também sai com 0).
    if (!opts.dryRun) {
      const after = readAccountState(ctx.claude, cenv);
      if (!('error' in after)) {
        for (const w of verifyInstall(after, plan.plugins, version!)) out(`  ! ${w}`);
      }
    }
  }

  if (opts.command === 'install' && !opts.dryRun && !failures) {
    out('');
    out('Pronto. Sessões novas do Claude Code já carregam o mod; nas que já estão abertas, rode /reload-plugins (ou');
    out('reabra a sessão). O uso de 5h/semanal chega ao Expediente depois da próxima resposta de cada sessão.');
    out('Para conferir: npm run instalar:status · Para desfazer: npm run desinstalar');
  }
  if (opts.command === 'uninstall' && !opts.dryRun && changed) {
    out('');
    out('Pronto. Sessões já abertas continuam com o mod até /reload-plugins (ou até reabrir a sessão).');
  }
  if (opts.command === 'uninstall' && !opts.dryRun && !failures && existsSync(copy)) {
    const bad = removeCopy(ctx.git, ctx.root, copy);
    out(bad ? `! não consegui remover a cópia fixa ${tildify(copy, home)} (${bad})` : `✓ cópia fixa removida: ${tildify(copy, home)}`);
  }
  if (opts.command === 'status') {
    // O mod e o plugin de permissões só falam com o Expediente local: diz se ele está lá para responder.
    const port = expedientePort(env);
    const health = await (ctx.health ?? fetchHealth)(port);
    const at = `Expediente em http://127.0.0.1:${port}`;
    if (!health) out(`${at}: fora do ar (o mod segue gravando o uso; os pedidos de permissão ficam só no terminal).`);
    else if (health.permissions) out(`${at}: no ar e respondendo pedidos de permissão (com alguma página aberta).`);
    else out(`${at}: no ar, mas responder pelo escritório está desligado (porta exposta na rede ou EXPEDIENTE_TERMINAL=0).`);
  }
  return failures ? 1 : 0;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') {
    console.log(USAGE);
    return;
  }
  const home = process.env.HOME || homedir();
  process.exitCode = await run(parsed, {
    env: process.env,
    home,
    now: new Date(),
    root: ROOT,
    git: makeGitRunner(),
    claude: makeClaudeRunner(parsed.claudeCmd),
    out: (l) => console.log(l),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err: unknown) => {
    console.error(err instanceof FatalError ? `[instalar] Erro: ${err.message}` : `[instalar] Erro inesperado: ${String(err)}`);
    process.exitCode = 1;
  });
}
