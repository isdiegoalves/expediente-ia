// "Focar a sessão": o navegador registra o pedido e o mod do Claude Code, que roda na máquina, o executa. O servidor
// só guarda `{token, agentId, pid}` em memória: o pid vem do registro do próprio agente, nunca do cliente.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, readJson, sendJson } from './app';
import { isLoopbackHost } from './guard';
import type { NonceStore } from './ir';
import type { Office } from '../model/office';

export const PEDIDO_VALIDADE_MS = 10_000;
/** Quanto o resultado fica consultável depois que o pedido nasceu. */
const RETENCAO_MS = 60_000;

export const RESULTADOS = ['focado', 'sem-painel', 'nao-e-claude'] as const;
export type ResultadoFoco = (typeof RESULTADOS)[number];
export type EstadoFoco = 'pendente' | 'assumido' | 'vencido' | ResultadoFoco;

interface Pedido {
  token: string;
  agentId: string;
  pid: number;
  criadoEm: number;
  assumido: boolean;
  resultado?: ResultadoFoco;
}

export type Assumir = { ok: true; pid: number } | { ok: false; motivo: 'desconhecido' | 'ja-assumido' | 'vencido' };

export class FocoStore {
  private readonly porToken = new Map<string, Pedido>();
  private readonly porAgente = new Map<string, string>();

  constructor(private readonly now: () => number) {}

  /** Um por agente: o pedido novo substitui o anterior. */
  criar(agentId: string, pid: number): string {
    this.varrer();
    const antigo = this.porAgente.get(agentId);
    if (antigo) this.porToken.delete(antigo);
    const token = randomBytes(16).toString('hex');
    this.porToken.set(token, { token, agentId, pid, criadoEm: this.now(), assumido: false });
    this.porAgente.set(agentId, token);
    return token;
  }

  pendentes(): { token: string; pid: number }[] {
    this.varrer();
    return [...this.porToken.values()].filter((p) => !p.assumido && !this.vencido(p)).map(({ token, pid }) => ({ token, pid }));
  }

  /** Só o primeiro assume. */
  assumir(token: string): Assumir {
    const p = this.porToken.get(token);
    if (!p) return { ok: false, motivo: 'desconhecido' };
    if (p.assumido) return { ok: false, motivo: 'ja-assumido' };
    if (this.vencido(p)) return { ok: false, motivo: 'vencido' };
    p.assumido = true;
    return { ok: true, pid: p.pid };
  }

  /** Só quem assumiu tem o que reportar, e só uma vez. */
  resultado(token: string, resultado: ResultadoFoco): boolean {
    const p = this.porToken.get(token);
    if (!p || !p.assumido || p.resultado) return false;
    p.resultado = resultado;
    return true;
  }

  estado(token: string): EstadoFoco | undefined {
    this.varrer();
    const p = this.porToken.get(token);
    if (!p) return undefined;
    if (p.resultado) return p.resultado;
    if (p.assumido) return 'assumido';
    return this.vencido(p) ? 'vencido' : 'pendente';
  }

  private vencido(p: Pedido): boolean {
    return this.now() > p.criadoEm + PEDIDO_VALIDADE_MS;
  }

  private varrer(): void {
    const limite = this.now() - RETENCAO_MS;
    for (const [token, p] of this.porToken) {
      if (p.criadoEm >= limite) continue;
      this.porToken.delete(token);
      if (this.porAgente.get(p.agentId) === token) this.porAgente.delete(p.agentId);
    }
  }
}

export interface FocarDeps {
  office: Office;
  nonces: NonceStore;
  focos: FocoStore;
}

function soLocal(req: IncomingMessage, res: ServerResponse): boolean {
  if (isLoopbackHost(req.headers.host)) return true;
  sendJson(res, 403, { error: 'focar a sessão só funciona pelo próprio computador (http://localhost ou http://127.0.0.1)' });
  return false;
}

function metodo(req: IncomingMessage, res: ServerResponse, permitido: 'GET' | 'POST'): boolean {
  if (req.method === permitido) return true;
  res.setHeader('Allow', permitido);
  sendJson(res, 405, { error: 'método não permitido' });
  return false;
}

/** `POST /api/agentes/:id/focar` com `{n}`: as mesmas travas do `/ir?abrir=1`. */
export async function handleFocarRoute(req: IncomingMessage, res: ServerResponse, id: string, { office, nonces, focos }: FocarDeps): Promise<void> {
  if (!metodo(req, res, 'POST') || !soLocal(req, res)) return;
  const site = req.headers['sec-fetch-site'];
  if (site !== undefined && site !== 'none' && site !== 'same-origin') return sendJson(res, 403, { error: 'pedido de outra origem' });
  const body = (await readJson(req)) as { n?: unknown } | null;
  const n = typeof body?.n === 'string' ? body.n : '';
  if (!nonces.consumir(n, id)) return sendJson(res, 403, { error: 'nonce ausente, vencido ou já usado' });
  const src = office.irSource(id);
  if (!src) return sendJson(res, 404, { error: 'agente não encontrado' });
  if (!src.vivo || src.origin !== 'terminal' || src.pid === undefined) return sendJson(res, 409, { error: 'esta sessão não é um terminal vivo para focar' });
  sendJson(res, 200, { token: focos.criar(id, src.pid) });
}

/** `GET /api/focos/:token`: o navegador consulta o andamento do pedido que fez. */
export function handleFocoEstado(req: IncomingMessage, res: ServerResponse, token: string, { focos }: Pick<FocarDeps, 'focos'>): void {
  if (!metodo(req, res, 'GET') || !soLocal(req, res)) return;
  const estado = focos.estado(token);
  if (!estado) return sendJson(res, 404, { error: 'pedido desconhecido' });
  sendJson(res, 200, { estado });
}

/**
 * Ponte do mod: `GET /api/mod/focos`, `POST /api/mod/focos/:token/assumir` e `POST /api/mod/focos/:token/resultado`.
 * Só loopback, como as demais rotas do mod: qualquer processo local pode chamá-las.
 */
export async function handleModFocosRoute(req: IncomingMessage, res: ServerResponse, token: string | undefined, acao: string | undefined, { focos }: Pick<FocarDeps, 'focos'>): Promise<void> {
  if (!soLocal(req, res)) return;
  if (!token) {
    if (!metodo(req, res, 'GET')) return;
    return sendJson(res, 200, { focos: focos.pendentes() });
  }
  if (!metodo(req, res, 'POST')) return;
  if (acao === 'assumir') {
    await readJson(req);
    const r = focos.assumir(token);
    if (r.ok) return sendJson(res, 200, { pid: r.pid });
    if (r.motivo === 'ja-assumido') return sendJson(res, 409, { error: 'já assumido' });
    return sendJson(res, r.motivo === 'vencido' ? 410 : 404, { error: r.motivo === 'vencido' ? 'pedido vencido' : 'pedido desconhecido' });
  }
  const body = (await readJson(req)) as { resultado?: unknown } | null;
  const resultado = RESULTADOS.find((r) => r === body?.resultado);
  if (!resultado) throw new HttpError(400, `esperado {resultado: ${RESULTADOS.join(' | ')}}`);
  if (!focos.resultado(token, resultado)) return sendJson(res, 409, { error: 'pedido não assumido ou já respondido' });
  sendJson(res, 200, { ok: true });
}
