// Rotas da API (/api/*). Respostas JSON; rotas desconhecidas -> 404 JSON.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { contextView, costView } from '../../shared/stats';
import type { AgentInfo, ModAgentUsage, ModSummary, OfficeSnapshot, SourceInfo } from '../../shared/types';
import type { AccountsService } from '../accounts/service';
import type { DayStatsService } from '../history/daystats';
import type { Office } from '../model/office';
import type { SessionHistory } from '../sources/history';
import { isJsonContentType, isLoopbackHost } from './guard';
import { FocoStore, handleFocarRoute, handleFocoEstado, handleModFocosRoute } from './focar';
import { handleIrRoute, NonceStore } from './ir';
import { handleSessionsRoute } from './sessions';
import type { Hub } from './sse';
import { handleStatsRoute } from './stats';
import type { TerminalStreams } from './terminal';

export interface ApiDeps {
  office: Office;
  hub: Hub;
  accounts: AccountsService;
  sources: () => SourceInfo[];
  version: string;
  inDocker: boolean;
  /** Terminal somente leitura, histórico e permissões ligados; função quando a trava muda durante a execução (publicacao.ts). */
  terminal?: boolean | (() => boolean);
  /** Streams do terminal; sem eles o recurso fica desligado mesmo com `terminal`. */
  terminals?: TerminalStreams;
  /** Histórico de sessões do terminal (GET /api/sessions/*, http/sessions.ts); mesma trava do terminal. */
  sessions?: SessionHistory;
  /** Rotas do timelapse (/api/timeline/*, ver http/timeline.ts); devolve false para o resto. */
  timeline?: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
  /**
   * Rotas de /api/permissions (responder pelo escritório, server/permissions/http.ts). Só existem com bind
   * local (ServerConfig.terminal); a trava do Host local é conferida aqui antes de chamá-las.
   */
  permissions?: (req: IncomingMessage, res: ServerResponse, path: string) => void;
  /** Estatísticas do "Meu dia" (GET /api/stats, http/stats.ts). */
  stats?: DayStatsService;
  /** Tema ativo: GET /api/tema e /temas/<id>/<arquivo> (http/tema.ts); devolve false para o resto. */
  tema?: (req: IncomingMessage, res: ServerResponse, url: URL) => boolean;
  /** Relógio dos nonces do /ir (testes). */
  now?: () => number;
}

/** GET /api/agents/:id/terminal (ids nunca contêm '/'). */
const TERMINAL_ROUTE = /^\/api\/agents\/([^/]+)\/terminal$/;

/** GET /api/agentes/:id/ir. */
const IR_ROUTE = /^\/api\/agentes\/([^/]+)\/ir$/;

/** POST /api/agentes/:id/focar, GET /api/focos/:token e as rotas do mod em /api/mod/focos. */
const FOCAR_ROUTE = /^\/api\/agentes\/([^/]+)\/focar$/;
const FOCO_ROUTE = /^\/api\/focos\/([0-9a-f]{32})$/;
const MOD_FOCOS_ROUTE = /^\/api\/mod\/focos(?:\/([0-9a-f]{32})\/(assumir|resultado))?$/;

const MAX_BODY = 256 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    // A API só é lida pela própria página: nada de leitura "no-cors" por outras origens.
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(data);
}

/** Lê o corpo JSON. Exige `Content-Type: application/json` (barreira contra CSRF; ver http/guard.ts). */
export function readJson(req: IncomingMessage): Promise<unknown> {
  if (!isJsonContentType(req.headers['content-type'])) {
    req.resume();
    return Promise.reject(new HttpError(415, 'envie o corpo como JSON (Content-Type: application/json)'));
  }
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      // Grande demais: continua drenando (sem guardar) para conseguir responder 413.
      if (size > MAX_BODY) return void fail(new HttpError(413, 'corpo grande demais'));
      chunks.push(c);
    });
    req.on('end', () => {
      if (size > MAX_BODY) return;
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) return ok({});
      try {
        ok(JSON.parse(raw));
      } catch {
        fail(new HttpError(400, 'JSON inválido'));
      }
    });
    req.on('error', fail);
  });
}

/** Subagentes aninhados mais fundo que isto não existem na prática; o limite só evita laço num parentId torto. */
const MAX_PARENT_HOPS = 16;

/**
 * Resumo para o mod do Claude Code (GET /api/mod/summary, ver ModSummary). `isReal` diz quem é agente de
 * verdade: os do demo vivem só no snapshot (não no Office), então `office.has(id)` os separa sem depender
 * do prefixo "demo:". A própria sessão sai quando vem `session` (e, se vier, `account` também precisa
 * bater): o principal tem o sessionId atual da sessão (troca no /clear) e os subagentes guardam o da
 * sessão que os disparou; por garantia, um subagente também sai quando algum ancestral (parentId) é dela.
 */
export function modSummary(
  snap: OfficeSnapshot,
  isReal: (id: string) => boolean,
  version: string,
  own: { account?: string; session?: string } = {},
): ModSummary {
  const byId = new Map(snap.agents.map((a) => [a.id, a]));
  const rooms = new Map(snap.rooms.map((r) => [r.id, r.name]));
  const isOwn = (a: AgentInfo): boolean => {
    if (!own.session || (own.account && a.account !== own.account)) return false;
    let cur: AgentInfo | undefined = a;
    for (let hops = 0; cur && hops <= MAX_PARENT_HOPS; hops++) {
      if (cur.sessionId === own.session) return true;
      cur = cur.parentId ? byId.get(cur.parentId) : undefined;
    }
    return false;
  };
  const present = snap.agents.filter((a) => isReal(a.id) && a.status !== 'offline' && a.status !== 'done' && !isOwn(a));
  const waiting = present
    .filter((a) => a.status === 'waiting')
    .sort((a, b) => a.statusSince - b.statusSince || a.id.localeCompare(b.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      room: rooms.get(a.roomId) ?? a.roomId,
      account: a.account,
      waitingFor: a.waitingFor ?? 'responder no terminal',
      since: a.statusSince,
      answerable: !!a.permission,
    }));
  const self = own.session ? snap.agents.find((a) => a.kind === 'main' && isReal(a.id) && a.sessionId === own.session && (!own.account || a.account === own.account)) : undefined;
  return {
    version,
    agents: present.length,
    working: present.filter((a) => a.status === 'working').length,
    waiting,
    usage: present.map((a) => usageOf(a, rooms)),
    ...(self ? { self: usageOf(self, rooms) } : {}),
  };
}

function usageOf(a: AgentInfo, rooms: ReadonlyMap<string, string>): ModAgentUsage {
  const out: ModAgentUsage = { id: a.id, name: a.name, kind: a.kind, status: a.status, room: rooms.get(a.roomId) ?? a.roomId, compactions: a.stats.compactionCount ?? 0 };
  if (a.title) out.title = a.title;
  if (a.origin) out.origin = a.origin;
  const context = contextView(a.stats);
  if (context) out.context = context;
  const last = a.stats.compactions?.at(-1);
  if (last) out.lastCompaction = { preTokens: last.preTokens, postTokens: last.postTokens };
  const cost = costView(a.stats);
  if (cost) out.cost = cost;
  return out;
}

/** Devolve um handler que trata /api/* e responde false para o resto. */
export function createApiHandler(deps: ApiDeps): (req: IncomingMessage, res: ServerResponse, url: URL) => boolean {
  const { office, hub, accounts } = deps;
  const nonces = new NonceStore(deps.now ?? Date.now);
  const focos = new FocoStore(deps.now ?? Date.now);
  const terminalOn = () => (typeof deps.terminal === 'function' ? deps.terminal() : deps.terminal === true);

  const methodNotAllowed = (res: ServerResponse, allow: string) => {
    res.setHeader('Allow', allow);
    sendJson(res, 405, { error: 'método não permitido' });
  };

  const handleDemo = async (req: IncomingMessage, res: ServerResponse) => {
    const body = (await readJson(req)) as { enabled?: unknown };
    if (typeof body?.enabled !== 'boolean') throw new HttpError(400, 'esperado {enabled: boolean}');
    office.setDemo(body.enabled);
    sendJson(res, 200, { ok: true, demo: office.isDemo() });
  };

  const fail = (res: ServerResponse, err: unknown) => {
    if (res.headersSent) return void res.destroy();
    if (err instanceof HttpError) sendJson(res, err.status, { error: err.message });
    else sendJson(res, 500, { error: 'erro interno' });
  };

  return (req, res, url) => {
    const path = url.pathname;
    if (deps.tema?.(req, res, url)) return true;
    if (path !== '/api' && !path.startsWith('/api/')) return false;
    const method = req.method ?? 'GET';
    const isRead = method === 'GET' || method === 'HEAD';

    if (path === '/api/stream') {
      if (method !== 'GET') methodNotAllowed(res, 'GET');
      else hub.attach(req, res);
      return true;
    }
    if (path === '/api/snapshot') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else sendJson(res, 200, hub.current());
      return true;
    }
    if (path === '/api/health') {
      if (!isRead) methodNotAllowed(res, 'GET');
      else {
        sendJson(res, 200, {
          ok: true,
          version: deps.version,
          demo: office.isDemo(),
          docker: deps.inDocker,
          terminal: terminalOn() && !!deps.terminals,
          permissions: terminalOn() && !!deps.permissions,
          sources: deps.sources(),
          accounts: accounts.entries().map((a) => ({ id: a.id, usageStatus: accounts.usageView(a.id).status })),
        });
      }
      return true;
    }
    if (path === '/api/mod/summary') {
      // Lido a cada 5 s por sessão com o mod: só contagens e quem espera (nada que o snapshot já não mostre).
      if (!isRead) methodNotAllowed(res, 'GET');
      else {
        const own = { account: url.searchParams.get('account') || undefined, session: url.searchParams.get('session') || undefined };
        sendJson(res, 200, modSummary(hub.current(), (id) => office.has(id), deps.version, own));
      }
      return true;
    }
    const terminals = terminalOn() ? deps.terminals : undefined;
    const terminalMatch = TERMINAL_ROUTE.exec(path);
    if (terminalMatch) {
      if (method !== 'GET') methodNotAllowed(res, 'GET');
      else if (!terminals) {
        sendJson(res, 403, { error: 'terminal somente leitura desligado: ele só funciona com o Expediente acessível apenas pelo próprio computador' });
      } else if (!isLoopbackHost(req.headers.host)) {
        sendJson(res, 403, { error: 'o terminal somente leitura só abre pelo próprio computador (http://localhost ou http://127.0.0.1)' });
      } else {
        let id: string;
        try {
          id = decodeURIComponent(terminalMatch[1]);
        } catch {
          sendJson(res, 400, { error: 'id inválido' });
          return true;
        }
        terminals.attach(req, res, id);
      }
      return true;
    }
    if (path.startsWith('/api/sessions/')) {
      handleSessionsRoute(req, res, path, { history: terminalOn() ? deps.sessions : undefined, terminals });
      return true;
    }
    if (path === '/api/permissions' || path.startsWith('/api/permissions/')) {
      // Responder pelo escritório age sobre as sessões: a mesma trava do terminal (bind local + Host local).
      if (!deps.permissions || !terminalOn()) {
        sendJson(res, 403, { error: 'responder pelo escritório desligado: só funciona com o Expediente acessível apenas pelo próprio computador' });
      } else if (!isLoopbackHost(req.headers.host)) {
        sendJson(res, 403, { error: 'pedidos de permissão só são respondidos pelo próprio computador (http://localhost ou http://127.0.0.1)' });
      } else {
        deps.permissions(req, res, path);
      }
      return true;
    }
    const modFocos = MOD_FOCOS_ROUTE.exec(path);
    const focoMatch = FOCO_ROUTE.exec(path);
    const focarMatch = FOCAR_ROUTE.exec(path);
    if ((modFocos || focoMatch || focarMatch) && !terminalOn()) {
      sendJson(res, 403, { error: 'focar a sessão desligado: só funciona com o Expediente acessível apenas pelo próprio computador' });
      return true;
    }
    if (modFocos) {
      handleModFocosRoute(req, res, modFocos[1], modFocos[2], { focos }).catch((err) => fail(res, err));
      return true;
    }
    if (focoMatch) {
      handleFocoEstado(req, res, focoMatch[1], { focos });
      return true;
    }
    if (focarMatch) {
      let id: string;
      try {
        id = decodeURIComponent(focarMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'id inválido' });
        return true;
      }
      handleFocarRoute(req, res, id, { office, nonces, focos }).catch((err) => fail(res, err));
      return true;
    }
    const irMatch = IR_ROUTE.exec(path);
    if (irMatch) {
      let id: string;
      try {
        id = decodeURIComponent(irMatch[1]);
      } catch {
        sendJson(res, 400, { error: 'id inválido' });
        return true;
      }
      handleIrRoute(req, res, url, id, { office, nonces });
      return true;
    }
    if (path.startsWith('/api/agents/')) {
      if (!isRead) {
        methodNotAllowed(res, 'GET');
        return true;
      }
      let id: string;
      try {
        id = decodeURIComponent(path.slice('/api/agents/'.length));
      } catch {
        sendJson(res, 400, { error: 'id inválido' });
        return true;
      }
      const detail = office.detail(id);
      if (detail) sendJson(res, 200, detail);
      else sendJson(res, 404, { error: 'agente não encontrado' });
      return true;
    }
    if (path === '/api/stats' || path.startsWith('/api/stats/')) {
      handleStatsRoute(req, res, url, deps.stats, sendJson);
      return true;
    }
    if (path === '/api/demo') {
      if (method !== 'POST') methodNotAllowed(res, 'POST');
      else handleDemo(req, res).catch((err) => fail(res, err));
      return true;
    }
    if (deps.timeline?.(req, res, url)) return true;
    sendJson(res, 404, { error: 'rota desconhecida' });
    return true;
  };
}
