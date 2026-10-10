// Resumo "desde que você saiu": contagens e, por sessão, a última tarefa em andamento. Puro e sem modelo: sai do
// snapshot (estado, "esperando há", "parado", tarefas e título), o mesmo para a janela e para o /escritorio resumo.
import { maskSecrets, truncate } from './activity';
import type { AgentInfo, RoomInfo } from './types';

/** Ausência a partir da qual a janela abre o resumo sozinha ao voltar. */
export const LIMITE_AUSENCIA_MS = 30 * 60_000;

export type EstadoResumo = 'espera' | 'travou' | 'terminou' | 'trabalhando' | 'ociosa';

export interface TarefaResumo {
  rotulo: 'Em andamento' | 'Próxima' | 'Último pedido';
  texto: string;
}

export interface SessaoResumo {
  id: string;
  nome: string;
  sala: string;
  estado: EstadoResumo;
  /** Espera: o que a sessão pede. Travou: o erro ou a chamada que não respondeu. */
  motivo?: string;
  tarefa?: TarefaResumo;
  /** Desde quando está nesse estado (epoch ms). */
  desde: number;
}

/** Resposta de GET /api/resumo. */
export interface ResumoView {
  desde: number;
  agora: number;
  terminaram: number;
  travaram: number;
  esperam: number;
  trabalhando: number;
  /** Mais urgentes primeiro: esperam, travaram, terminaram, trabalhando, ociosas. */
  sessoes: SessaoResumo[];
}

/** Resposta de POST /api/resumo/presenca. */
export interface PresencaResposta {
  /** Quando a última aba visível saiu (epoch ms); null enquanto ninguém saiu desde que o servidor guarda. */
  saiuEm: number | null;
  /** Esta chamada é a volta depois de uma ausência de pelo menos LIMITE_AUSENCIA_MS. */
  mostrar: boolean;
}

export interface EntradaResumo {
  agents: readonly AgentInfo[];
  rooms: readonly RoomInfo[];
}

export interface OpcoesResumo {
  /** Quem é agente de verdade (o demo fica de fora no servidor). */
  isReal?: (id: string) => boolean;
  /** Esta sessão não conta: o agente principal dela e os subagentes. */
  propria?: { account?: string; session?: string };
}

const MAX_TEXTO = 140;
const MAX_PAIS = 16;
const ORDEM: Record<EstadoResumo, number> = { espera: 0, travou: 1, terminou: 2, trabalhando: 3, ociosa: 4 };

function limpo(s: string | undefined, max = MAX_TEXTO): string | undefined {
  if (!s) return undefined;
  const t = truncate(maskSecrets(s.slice(0, max * 4)), max);
  return t || undefined;
}

/** A última tarefa em andamento; sem ela, a próxima pendente; sem tarefas, o pedido que dá nome à sessão. */
export function tarefaDaSessao(a: Pick<AgentInfo, 'tasks' | 'title'>): TarefaResumo | undefined {
  const emAndamento = [...a.tasks].reverse().find((t) => t.status === 'in_progress');
  const andamento = limpo(emAndamento?.activeForm || emAndamento?.title);
  if (andamento) return { rotulo: 'Em andamento', texto: andamento };
  const pendente = limpo(a.tasks.find((t) => t.status === 'pending')?.title);
  if (pendente) return { rotulo: 'Próxima', texto: pendente };
  const pedido = limpo(a.title);
  return pedido ? { rotulo: 'Último pedido', texto: pedido } : undefined;
}

function motivoParado(a: AgentInfo): string | undefined {
  const p = a.parado;
  if (!p) return undefined;
  const base = p.erro ?? (p.pendente ? `sem resposta de ${p.pendente}` : 'sem escrever há tempo');
  return limpo(a.kind === 'sub' ? `${a.agentName ?? a.name}: ${base}` : base);
}

export function montarResumo(entrada: EntradaResumo, desde: number, agora: number, opts: OpcoesResumo = {}): ResumoView {
  const real = opts.isReal ?? (() => true);
  const salas = new Map(entrada.rooms.map((r) => [r.id, r.name]));
  const porId = new Map(entrada.agents.map((a) => [a.id, a]));
  const { account, session } = opts.propria ?? {};
  const presente = (a: AgentInfo) => real(a.id) && a.status !== 'offline' && a.status !== 'done';
  const raizDe = (a: AgentInfo): AgentInfo | undefined => {
    let cur: AgentInfo | undefined = a;
    for (let i = 0; cur && i <= MAX_PAIS; i++) {
      if (cur.kind === 'main') return cur;
      cur = cur.parentId ? porId.get(cur.parentId) : undefined;
    }
    return undefined;
  };
  const propria = (a: AgentInfo) => !!session && a.sessionId === session && (!account || a.account === account);

  const travados = new Map<string, AgentInfo[]>();
  for (const a of entrada.agents) {
    if (!presente(a) || propria(a) || a.status !== 'working' || !a.parado) continue;
    const raiz = raizDe(a);
    if (raiz) travados.set(raiz.id, [...(travados.get(raiz.id) ?? []), a]);
  }

  const sessoes: SessaoResumo[] = [];
  for (const a of entrada.agents) {
    if (a.kind !== 'main' || !presente(a) || propria(a)) continue;
    const parados = (travados.get(a.id) ?? []).sort((x, y) => (x.parado?.desde ?? 0) - (y.parado?.desde ?? 0));
    const base = { id: a.id, nome: limpo(a.name, 60) ?? a.id, sala: limpo(salas.get(a.roomId) ?? a.roomId, 60) ?? '?', tarefa: tarefaDaSessao(a) };
    let s: SessaoResumo;
    if (a.status === 'waiting') {
      s = { ...base, estado: 'espera', motivo: limpo(a.waitingFor) ?? 'responder no terminal', desde: a.statusSince };
    } else if (parados.length) {
      const primeiro = motivoParado(parados[0]);
      const mais = parados.length > 1 ? ` (+${parados.length - 1})` : '';
      s = { ...base, estado: 'travou', ...(primeiro ? { motivo: `${primeiro}${mais}` } : {}), desde: parados[0].parado?.desde ?? a.statusSince };
    } else if (a.status === 'idle') {
      s = { ...base, estado: a.statusSince >= desde ? 'terminou' : 'ociosa', desde: a.statusSince };
    } else {
      s = { ...base, estado: 'trabalhando', desde: a.statusSince };
    }
    if (!s.tarefa) delete s.tarefa;
    sessoes.push(s);
  }
  sessoes.sort((x, y) => ORDEM[x.estado] - ORDEM[y.estado] || (x.estado === 'terminou' ? y.desde - x.desde : x.desde - y.desde) || x.id.localeCompare(y.id));
  const conta = (e: EstadoResumo) => sessoes.filter((s) => s.estado === e).length;
  return { desde, agora, terminaram: conta('terminou'), travaram: conta('travou'), esperam: conta('espera'), trabalhando: conta('trabalhando'), sessoes };
}
