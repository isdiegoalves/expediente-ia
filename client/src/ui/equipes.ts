import type { AgentInfo } from '../../../shared/types';
import { h, setHidden, setText } from './dom';

export interface RodadaResumo {
  n: number;
  concluidos: number;
  total: number;
}

export interface GrupoSubs {
  tipo: 'grupo';
  key: string;
  time?: string;
  /** Nome do agente que disparou, para quem não tem time. */
  pai?: string;
  concluidos: number;
  total: number;
  rodadas: RodadaResumo[];
}

export interface ItemSub {
  tipo: 'sub';
  agent: AgentInfo;
}

export type ItemSubs = GrupoSubs | ItemSub;

const concluido = (a: AgentInfo) => a.status === 'done' || a.status === 'offline';

export function soSubs(agents: readonly AgentInfo[]): ItemSubs[] {
  return agents.map((agent) => ({ tipo: 'sub', agent }));
}

/**
 * Cabeçalhos de grupo (time, senão o pai) antes dos subagentes. Sem time nem rodada em nenhum deles a lista
 * segue plana, como antes.
 */
export function itensDeSubs(subs: readonly AgentInfo[], paiNome: (id: string) => string | undefined): ItemSubs[] {
  if (!subs.some((s) => s.teamName || s.rodada !== undefined)) return soSubs(subs);
  const grupos = new Map<string, AgentInfo[]>();
  for (const s of subs) {
    const key = s.teamName ? `time:${s.teamName}` : `pai:${s.parentId ?? ''}`;
    const lista = grupos.get(key);
    if (lista) lista.push(s);
    else grupos.set(key, [s]);
  }
  const out: ItemSubs[] = [];
  for (const [key, lista] of grupos) {
    const rodadas = new Map<number, RodadaResumo>();
    for (const s of lista) {
      if (s.rodada === undefined) continue;
      const r = rodadas.get(s.rodada) ?? { n: s.rodada, concluidos: 0, total: 0 };
      r.total++;
      if (concluido(s)) r.concluidos++;
      rodadas.set(s.rodada, r);
    }
    const g: GrupoSubs = {
      tipo: 'grupo',
      key: `grupo:${key}`,
      concluidos: lista.filter(concluido).length,
      total: lista.length,
      rodadas: [...rodadas.values()].sort((a, b) => a.n - b.n),
    };
    if (lista[0].teamName) g.time = lista[0].teamName;
    else {
      const pai = lista[0].parentId ? paiNome(lista[0].parentId) : undefined;
      if (pai) g.pai = pai;
    }
    out.push(g, ...soSubs(lista));
  }
  return out;
}

export function tituloGrupo(g: GrupoSubs): string {
  return g.time ? `Time ${g.time}` : g.pai ? `Sem time (${g.pai})` : 'Sem time';
}

export function resumoGrupo(g: GrupoSubs): string {
  const partes = [`${g.concluidos}/${g.total} concluídos`];
  for (const r of g.rodadas) partes.push(`rodada ${r.n}: ${r.concluidos}/${r.total}`);
  return partes.join(' · ');
}

export function createGrupoHead(): HTMLElement {
  return h('div', { class: 'ui-grupo', role: 'group' }, h('span', { class: 'ui-grupo__titulo' }), h('span', { class: 'ui-grupo__resumo' }));
}

export function updateGrupoHead(el: HTMLElement, g: GrupoSubs): void {
  setText(el.firstElementChild as HTMLElement, tituloGrupo(g));
  setText(el.lastElementChild as HTMLElement, resumoGrupo(g));
  setHidden(el, false);
}

export const itemKey = (i: ItemSubs): string => (i.tipo === 'grupo' ? i.key : i.agent.id);
