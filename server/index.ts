// Servidor do Expediente: observa as sessões abertas do Claude Code (todas as contas),
// mantém o modelo do escritório e transmite via SSE. Sem dependências de runtime.
//   npm run dev    -> tsx server/index.ts --dev (Vite em middleware mode, HMR no mesmo servidor)
//   npm start      -> node dist/server/index.js (serve dist/client)
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import { AccountsService } from './accounts/service';
import { loadConfig, terminalOffReason } from './config';
import { usarArquivoDoDono } from './custo/precos';
import { createApiHandler, sendJson } from './http/app';
import { createRequestGuard } from './http/guard';
import { createTerminalGate, PUBLICACAO_ARQUIVO } from './publicacao';
import { Hub } from './http/sse';
import { createStaticHandler } from './http/static';
import { createTemaHandler } from './http/tema';
import { TerminalStreams } from './http/terminal';
import { createTimelineHandler } from './http/timeline';
import { TIMELINE_DIR, TimelineRecorder } from './history/timeline';
import { DayStatsService } from './history/daystats';
import { Presenca } from './history/resumo';
import { errMsg, log } from './log';
import { NameStore } from './model/names';
import { Office } from './model/office';
import { RoomAliases } from './model/room-aliases';
import { openMainAgent, SessionHistory } from './sources/history';
import { createPermissionRoutes } from './permissions/http';
import { PermissionRegistry } from './permissions/registry';
import { LivroSocial, SOCIAL_ARQUIVO } from './social/livro';
import { SessoesAppReader } from './sources/sessoes-app';
import { ClaudeWatcher } from './sources/watcher';
import { createBuildReader } from './build';
import { carregarTema } from './tema/carregar';
import { createVersaoReader } from './versao';

const config = loadConfig();
usarArquivoDoDono(join(config.hostDir, 'precos.json'));
// Terminal, histórico e permissões: no container só com a publicação da porta confirmada pelo docker-up.
const gate = createTerminalGate({ terminal: config.terminal, inDocker: config.inDocker, file: join(config.dataDir, PUBLICACAO_ARQUIVO) });
const startedAt = Date.now();

const names = new NameStore(join(config.dataDir, 'names.json'));
names.load();
// Nomes de sala escolhidos pelo usuário (botão direito > Renomear).
const roomAliases = new RoomAliases(join(config.dataDir, 'rooms.json'));
roomAliases.load();

// Office, contas e watcher se referenciam (avisos de mudança / fontes): ligação tardia.
const sessoesApp = new SessoesAppReader(config.sessoesAppFile);
const late: { office?: Office; watcher?: ClaudeWatcher; permissions?: PermissionRegistry; social?: LivroSocial } = {};
const accounts = new AccountsService({
  dirs: config.claudeDirs,
  home: config.home,
  env: process.env,
  usageDir: config.usageDir,
  onChange: () => late.office?.markDirty(),
});
const office = new Office({
  names,
  roomAlias: (path) => roomAliases.get(path),
  version: config.version,
  // No modo dev o Vite serve o cliente direto do código-fonte: não há build para comparar.
  build: config.dev ? undefined : createBuildReader(config.rootDir),
  startedAt,
  accounts: (sessions) => accounts.list(sessions),
  sources: () => late.watcher?.sources() ?? [],
  accountName: (id) => accounts.find(id)?.detected.name,
  terminal: gate.on,
  permissions: () => late.permissions?.snapshot() ?? new Map(),
  sessoesApp: () => sessoesApp.read(Date.now()),
  social: () => late.social?.estado(),
});
const watcher = new ClaudeWatcher({ accounts, office, inDocker: config.inDocker });
late.office = office;
late.watcher = watcher;
const hub = new Hub(office);
// Rodas e carteiras: a agenda roda aqui, todas as abas animam as mesmas rodas e o livro fica em <dataDir>/social.json.
const social = new LivroSocial({ arquivo: join(config.dataDir, SOCIAL_ARQUIVO), agentes: () => hub.current().agents, mudou: () => office.markDirty() });
late.social = social;
// "Meu dia": amostra o escritório a cada segundo e persiste em <dataDir>/stats/ (ver history/daystats.ts).
const stats = new DayStatsService({ dir: join(config.dataDir, 'stats'), snapshot: () => hub.current() });
stats.load();
const presenca = new Presenca(join(config.dataDir, 'resumo.json'));
presenca.load();
// Terminal somente leitura: desligável por EXPEDIENTE_TERMINAL (ver terminalOffReason em config.ts).
const terminals = config.terminal ? new TerminalStreams({ office, transcriptPathOf: (id) => watcher.transcriptPathOf(id) }) : undefined;
// Histórico do terminal (sessões recentes, abertas ou encerradas): mesma trava.
const history = config.terminal
  ? new SessionHistory({ accounts: () => accounts.entries(), openAgentOf: (acc, sid) => openMainAgent(office.list(), acc, sid) })
  : undefined;
// Linha do tempo do timelapse: grava cada snapshot novo (com throttle) em <dataDir>/timeline.
const timelineDir = join(config.dataDir, TIMELINE_DIR);
const timeline = config.timeline ? new TimelineRecorder({ dir: timelineDir }) : undefined;
if (timeline) hub.onSnapshot((snap) => timeline.ingest(snap));
// Responder pelo escritório (hook PermissionRequest): age sobre as sessões, então segue a mesma trava.
const permissions = config.terminal
  ? new PermissionRegistry({
      office,
      viewers: () => hub.localSize,
      transcriptPathOf: (id) => watcher.transcriptPathOf(id),
      demoDecide: (id, d) => office.decideDemoPermission(id, d),
      demoDetail: (id) => office.demoPermission(id),
    })
  : undefined;
late.permissions = permissions;

if (config.demo) office.setDemo(true);
watcher.start();
accounts.start();
hub.start();
social.start();
if (timeline) {
  timeline.start();
  timeline.ingest(hub.current());
}
permissions?.start();
stats.start();
const ticker = setInterval(() => {
  try {
    office.tick();
  } catch (err) {
    log.warnOnce(`tick:${errMsg(err)}`, `Falha no relógio do escritório: ${errMsg(err)}`);
  }
}, 250);

// O mapa do app muda sem o registro de sessões mudar: avisa o escritório para refazer o snapshot.
let mapaDoApp = '';
const mapaTimer = setInterval(() => {
  const atual = JSON.stringify([...sessoesApp.read(Date.now())]);
  if (atual === mapaDoApp) return;
  mapaDoApp = atual;
  office.markDirty();
}, 5_000);

const pastasDoTema = { hostDir: config.hostDir, padraoDir: join(config.rootDir, config.dev ? 'client/public' : 'dist/client', 'temas/padrao') };
const temaAtivo = carregarTema(pastasDoTema);
if (temaAtivo.aviso) log.warn(temaAtivo.aviso);

const api = createApiHandler({
  renameRoom: (id, name) => {
    const path = office.roomPath(id);
    if (!path) return undefined;
    roomAliases.set(path, name);
    office.refreshRoomNames();
    return office.roomName(id);
  },
  office,
  hub,
  accounts,
  sources: () => watcher.sources(),
  version: config.version,
  inDocker: config.inDocker,
  terminal: gate.on,
  terminals,
  sessions: history,
  timeline: createTimelineHandler({ dir: timelineDir, recording: !!timeline }),
  permissions: permissions ? createPermissionRoutes(permissions) : undefined,
  stats,
  resumo: { presenca, inicio: startedAt },
  versao: createVersaoReader(join(config.hostDir, 'versao.json'), config.version),
  tema: createTemaHandler(pastasDoTema, temaAtivo, sendJson),
});

const server = createServer();
let closeVite: (() => Promise<void>) | undefined;

function parseUrl(req: IncomingMessage): URL {
  try {
    return new URL(req.url ?? '/', 'http://localhost');
  } catch {
    return new URL('/', 'http://localhost');
  }
}

/** Quem atende o que não é /api: o Vite (dev) ou os arquivos de dist/client (produção). */
let fallback: (req: IncomingMessage, res: ServerResponse, url: URL) => void;
if (config.dev) {
  // Import dinâmico: o bundle de produção nunca carrega o Vite.
  const { createServer } = await import('vite');
  const vite = await createServer({
    configFile: join(config.rootDir, 'vite.config.ts'),
    server: { middlewareMode: true, ws: { server } },
    appType: 'spa',
  });
  closeVite = () => vite.close();
  fallback = (req, res) => vite.middlewares(req, res);
} else {
  const serveStatic = createStaticHandler(join(config.rootDir, 'dist', 'client'));
  fallback = (req, res, url) => serveStatic(req, res, url.pathname);
}

// Host/Origin/Content-Type: barra DNS rebinding e CSRF antes de qualquer rota (inclusive o Vite).
const guard = createRequestGuard();

server.on('request', (req, res) => {
  const url = parseUrl(req);
  try {
    if (guard(req, res)) return;
    if (!api(req, res, url)) fallback(req, res, url);
  } catch (err) {
    log.warn(`Erro ao responder ${req.method} ${url.pathname}: ${errMsg(err)}`);
    if (!res.headersSent) sendJson(res, 500, { error: 'erro interno' });
    else res.destroy();
  }
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') log.error(`A porta ${config.port} já está em uso (defina EXPEDIENTE_PORT para usar outra).`);
  else log.error(`Erro no servidor HTTP: ${errMsg(err)}`);
  process.exit(1);
});

server.listen(config.port, config.host, () => {
  const host = config.host === '0.0.0.0' || config.host === '::' ? 'localhost' : config.host;
  log.info(`🏢 Expediente ${config.version}${config.dev ? ' (dev)' : ''}${config.inDocker ? ' (docker)' : ''} em http://${host}:${config.port}`);
  const list = accounts.entries();
  if (!list.length) log.warn('Nenhuma pasta do Claude Code encontrada (defina EXPEDIENTE_CLAUDE_DIRS).');
  for (const a of list) {
    const src = watcher.sources().find((s) => s.label === a.id);
    const usage = accounts.usageView(a.id).status;
    log.info(`   Conta ${a.detected.short} (${a.id}): ${src?.sessions ?? 0} sessão(ões) aberta(s) · uso: ${usage} · ${a.dir}`);
  }
  log.info(`   Tema: ${temaAtivo.id}.`);
  if (office.isDemo()) log.info('   Modo demonstração ligado (agentes simulados misturados aos reais).');
  const off = gate.offReason();
  if (off === undefined) log.info('   Terminal somente leitura: ligado (acesso só local).');
  else log.info(`   Terminal somente leitura: desligado (${terminalOffReason(process.env) ?? off})${terminalOffReason(process.env) ? '' : '; liga sozinho quando o docker-up confirmar a publicação'}.`);
  log.info(timeline ? `   Linha do tempo (timelapse): gravando em ${timelineDir}.` : '   Linha do tempo (timelapse): gravação desligada (EXPEDIENTE_TIMELINE).');
  log.info(`   Responder pelo escritório: ${off === undefined ? 'ligado (precisa do plugin de permissões: npm run instalar -- --com-permissoes)' : 'desligado (mesma trava do terminal)'}.`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`Encerrando (${signal})…`);
  clearInterval(ticker);
  clearInterval(mapaTimer);
  stats.stop();
  watcher.stop();
  accounts.stop();
  hub.stop();
  terminals?.stop();
  timeline?.stop();
  permissions?.stop();
  social.stop();
  names.flush();
  void closeVite?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1_500).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
