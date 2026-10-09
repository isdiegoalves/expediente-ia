// "Ir para a sessão": o comando seguro e os links vêm do servidor, montados dos próprios dados do agente
// (nunca de argv ou caminho vindos do cliente), e o 302 para o app só sai com nonce de uso único.
import { randomBytes } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { maskSecrets } from '../../shared/activity';
import type { IrInfo } from '../../shared/types';
import type { Office } from '../model/office';
import { sanitizeOutput } from '../model/saida';
import { sendJson } from './app';
import { isLoopbackHost } from './guard';

export const NONCE_VALIDADE_MS = 60_000;
// Sem traço no começo: o id entra no comando copiado e não pode virar opção do claude.
const ID_SESSAO = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;
const ID_APP = /^local_[A-Za-z0-9-]{1,64}$/;
const AVISO_FORK = 'cria uma cópia, não responde à sessão original';

const LISTA_PERMITIDA = [
  /^claude:\/\/code\/(?:continue|needs-input)\?session=local_[A-Za-z0-9-]{1,64}$/,
  /^claude:\/\/resume\?session=[A-Za-z0-9][A-Za-z0-9-]{0,63}$/,
];

/** Só estas URLs saem num redirecionamento que faz o sistema abrir o app. */
export function urlPermitida(url: string): boolean {
  return LISTA_PERMITIDA.some((re) => re.test(url));
}

/** Quantos nonces vivos cada agente guarda: dois painéis e o navegador não se expulsam, e o limite é por agente. */
export const NONCES_POR_AGENTE = 8;

export class NonceStore {
  private readonly itens = new Map<string, { agentId: string; venceEm: number }>();
  private readonly doAgente = new Map<string, string[]>();

  constructor(private readonly now: () => number) {}

  emitir(agentId: string): string {
    const nonce = randomBytes(16).toString('hex');
    const vivos = (this.doAgente.get(agentId) ?? []).filter((n) => this.itens.has(n));
    vivos.push(nonce);
    while (vivos.length > NONCES_POR_AGENTE) this.itens.delete(vivos.shift() as string);
    this.doAgente.set(agentId, vivos);
    this.itens.set(nonce, { agentId, venceEm: this.now() + NONCE_VALIDADE_MS });
    return nonce;
  }

  /** Uso único: o nonce some ao ser conferido, valendo ou não. */
  consumir(nonce: string, agentId: string): boolean {
    const item = this.itens.get(nonce);
    if (!item) return false;
    this.itens.delete(nonce);
    const vivos = this.doAgente.get(item.agentId)?.filter((n) => n !== nonce) ?? [];
    if (vivos.length) this.doAgente.set(item.agentId, vivos);
    else this.doAgente.delete(item.agentId);
    return item.agentId === agentId && this.now() <= item.venceEm;
  }
}

/** Controle (C0, DEL, C1), separadores de linha e marcas de direção do Unicode: o que se cola não é o que se vê. */
const INVISIVEL = /[\x00-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/;

function entreAspas(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function montar(src: NonNullable<ReturnType<Office['irSource']>>): Omit<IrInfo, 'nonce'> | undefined {
  if (!ID_SESSAO.test(src.sessionId)) return undefined;
  const { sessionId, vivo, origin } = src;
  const cwd = maskSecrets(src.cwd);
  const noApp = origin === 'app desktop';
  const cwdLimpo = !INVISIVEL.test(cwd);
  const links = cwdLimpo
    ? [
        noApp
          ? { rotulo: 'Abrir o projeto no app', href: `claude://code/new?folder=${encodeURIComponent(cwd)}` }
          : { rotulo: 'Abrir o projeto no terminal', href: `claude-cli://open?cwd=${encodeURIComponent(cwd)}` },
      ]
    : [];
  const direto = vivo && noApp && src.appSessionId && ID_APP.test(src.appSessionId) ? `claude://code/continue?session=${src.appSessionId}` : undefined;
  if (direto && urlPermitida(direto)) links.unshift({ rotulo: 'Abrir a sessão no app', href: direto });
  const base = { estado: vivo ? ('vivo' as const) : ('encerrado' as const), ...(origin ? { origin } : {}) };
  if (!vivo) {
    if (origin === 'terminal') links.push({ rotulo: 'Retomar no app', href: `claude://resume?session=${sessionId}` });
    return { ...base, comando: `${cwdLimpo ? `cd -- ${entreAspas(cwd)} && ` : ''}claude --resume ${sessionId}`, links };
  }
  if (!noApp && (src.kind === 'bg' || src.kind === 'background')) return { ...base, comando: `claude attach ${sessionId}`, links };
  return { ...base, comando: `claude --resume ${sessionId} --fork-session`, aviso: AVISO_FORK, links };
}

export interface IrDeps {
  office: Office;
  nonces: NonceStore;
}

/** `GET /api/agentes/:id/ir` (JSON) e `?abrir=1&n=<nonce>` (302). */
export function handleIrRoute(req: IncomingMessage, res: ServerResponse, url: URL, id: string, { office, nonces }: IrDeps): void {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendJson(res, 405, { error: 'método não permitido' });
  }
  if (!isLoopbackHost(req.headers.host)) {
    return sendJson(res, 403, { error: 'o atalho para a sessão só abre pelo próprio computador (http://localhost ou http://127.0.0.1)' });
  }
  const src = office.irSource(id);
  const ir = src && montar(src);
  if (!src || !ir) return sendJson(res, 404, { error: 'agente não encontrado' });

  const site = req.headers['sec-fetch-site'];
  const deDentro = site === undefined || site === 'none' || site === 'same-origin';
  // O comando seguro vai direto para a área de transferência: segredo sai mascarado, o caminho fica.
  if (url.searchParams.get('abrir') !== '1') return sendJson(res, 200, sanitizeOutput(deDentro ? { ...ir, nonce: nonces.emitir(id) } : ir, new Map(), { trocarCaminhos: false }));
  if (!deDentro) return sendJson(res, 403, { error: 'pedido de outra origem' });
  if (!nonces.consumir(url.searchParams.get('n') ?? '', id)) return sendJson(res, 403, { error: 'nonce ausente, vencido ou já usado' });
  const destino = src.appSessionId && ID_APP.test(src.appSessionId) ? `claude://code/continue?session=${src.appSessionId}` : undefined;
  if (!destino || !urlPermitida(destino)) return sendJson(res, 409, { error: 'esta sessão não tem link direto para o app' });
  res.writeHead(302, { Location: destino, 'Cache-Control': 'no-store', 'Content-Length': 0 });
  res.end();
}
