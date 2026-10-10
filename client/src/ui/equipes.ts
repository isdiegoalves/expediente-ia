import { chaveEquipe } from '../../../shared/equipes';
import type { AgentInfo, ContagemEquipe, EquipeResumo } from '../../../shared/types';
import { h, setHidden, setText } from './dom';

export type RodadaResumo = ContagemEquipe & { n: number };

export interface GrupoSubs extends ContagemEquipe {
  tipo: 'grupo';
  key: string;
  time?: string;
  /** Nome do agente que disparou, para quem não tem time. */
  pai?: string;
  rodadas: RodadaResumo[];
  paradosPorVoce: number;
}

export interface ItemSub {
  tipo: 'sub';
  agent: AgentInfo;
}

export type ItemSubs = GrupoSubs | ItemSub;

const zerada = (): ContagemEquipe => ({ trabalhando: 0, aToa: 0, concluidos: 0, total: 0 });

function somar(c: ContagemEquipe, a: AgentInfo): void {
  c.total++;
  if (a.status === 'done' || a.status === 'offline') c.concluidos++;
  else if (a.status === 'idle') c.aToa++;
  else c.trabalhando++;
}

export function soSubs(agents: readonly AgentInfo[]): ItemSubs[] {
  return agents.map((agent) => ({ tipo: 'sub', agent }));
}

/**
 * Cabeçalhos de grupo (time, senão o pai) antes dos subagentes. Sem time nem rodada em nenhum deles a lista
 * segue plana, como antes. A contagem vem do servidor (`equipes`); sem ela, conta só os que estão na lista.
 */
export function itensDeSubs(
  subs: readonly AgentInfo[],
  paiNome: (id: string) => string | undefined,
  equipes: readonly EquipeResumo[] = [],
): ItemSubs[] {
  if (!subs.some((s) => s.teamName || s.rodada !== undefined)) return soSubs(subs);
  const grupos = new Map<string, AgentInfo[]>();
  for (const s of subs) {
    const key = chaveEquipe(s);
    const lista = grupos.get(key);
    if (lista) lista.push(s);
    else grupos.set(key, [s]);
  }
  const out: ItemSubs[] = [];
  for (const [key, lista] of grupos) {
    const rodadas = new Map<number, RodadaResumo>();
    for (const s of lista) {
      if (s.rodada === undefined) continue;
      const r = rodadas.get(s.rodada) ?? { n: s.rodada, ...zerada() };
      somar(r, s);
      rodadas.set(s.rodada, r);
    }
    const publicada = equipes.find((e) => e.key === key);
    const local = zerada();
    if (!publicada) for (const s of lista) somar(local, s);
    const g: GrupoSubs = {
      tipo: 'grupo',
      key: `grupo:${key}`,
      trabalhando: publicada?.trabalhando ?? local.trabalhando,
      aToa: publicada?.aToa ?? local.aToa,
      concluidos: publicada?.concluidos ?? local.concluidos,
      total: publicada?.total ?? local.total,
      rodadas: publicada?.rodadas ?? [...rodadas.values()].sort((a, b) => a.n - b.n),
      paradosPorVoce: publicada?.paradosPorVoce ?? lista.filter((s) => s.stoppedByUser).length,
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
  const partes: string[] = [];
  if (g.trabalhando) partes.push(`${g.trabalhando} trabalhando`);
  if (g.aToa) partes.push(`${g.aToa} à toa`);
  if (g.concluidos) partes.push(`${g.concluidos} ${g.concluidos === 1 ? 'concluído' : 'concluídos'}`);
  for (const r of g.rodadas) partes.push(`rodada ${r.n}: ${r.concluidos} de ${r.total} concluídos`);
  if (g.paradosPorVoce) partes.push(`${g.paradosPorVoce} ${g.paradosPorVoce === 1 ? 'parado' : 'parados'} por você`);
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
