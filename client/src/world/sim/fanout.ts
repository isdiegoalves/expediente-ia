// Fan-out numa sala: no máximo MAX_INDIVIDUAIS subagentes andam pelo escritório como personagens; os demais
// ficam na roda da equipe, contados por estado.
import { chaveEquipe } from '../../../../shared/equipes';
import type { AgentInfo, AgentKind, AgentStatus } from '../../../../shared/types';
import { lugarDaRoda, type LugarDaRoda } from '../layout/roda';
import type { AreaLayout } from '../layout/types';

export const MAX_INDIVIDUAIS = 8;

export type EstadoNaRoda = 'esperando' | 'trabalhando' | 'aToa' | 'concluido';

export function estadoNaRoda(s: AgentStatus): EstadoNaRoda {
  if (s === 'waiting') return 'esperando';
  if (s === 'done' || s === 'offline') return 'concluido';
  if (s === 'idle') return 'aToa';
  return 'trabalhando';
}

const ORDEM: Record<EstadoNaRoda, number> = { esperando: 0, trabalhando: 1, aToa: 2, concluido: 3 };

const ativo = (a: AgentInfo): boolean => a.status !== 'done' && a.status !== 'offline';

/** Quem espera você primeiro, depois quem trabalha, à toa e concluídos; no mesmo estado, por ordem de chegada. */
export function ordemNaRoda(a: AgentInfo, b: AgentInfo): number {
  return ORDEM[estadoNaRoda(a.status)] - ORDEM[estadoNaRoda(b.status)] || a.startedAt - b.startedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export interface Escolha {
  /** Passam para a simulação (inclui quem já era personagem, concluiu e ainda está entregando). */
  individuais: Set<string>;
  /** Ficam na roda, em `ordemNaRoda`. */
  roda: AgentInfo[];
}

/**
 * Escolhe quem é personagem numa sala. Quem já era continua, sem troca a cada snapshot, até concluir e sair de cena
 * (aí entra na roda como concluído). Uma vaga só abre quando o personagem sai de cena e vai primeiro para quem espera
 * você, depois para quem trabalha, por ordem de chegada. Quem espera e não acha vaga (nem vai achar com quem já está
 * saindo) tira a de quem só trabalha, o mais novo. `emCena`: subagentes da sala que têm personagem agora, inclusive
 * os que estão saindo.
 */
export function escolherIndividuais(subs: readonly AgentInfo[], anteriores: ReadonlySet<string>, emCena: ReadonlySet<string>, max = MAX_INDIVIDUAIS): Escolha {
  const individuais = new Set<string>();
  for (const s of subs) if (anteriores.has(s.id) && (ativo(s) || emCena.has(s.id))) individuais.add(s.id);
  const ocupadas = () => {
    let n = emCena.size;
    for (const s of subs) if (individuais.has(s.id) && ativo(s) && !emCena.has(s.id)) n++;
    return n;
  };
  const candidatos = subs.filter((s) => ativo(s) && !individuais.has(s.id) && !emCena.has(s.id)).sort(ordemNaRoda);
  let livres = max - ocupadas();
  for (const c of candidatos) {
    if (livres <= 0) break;
    individuais.add(c.id);
    livres--;
  }
  const esperando = candidatos.filter((c) => c.status === 'waiting' && !individuais.has(c.id));
  if (esperando.length) {
    const ficam = subs.filter((s) => individuais.has(s.id) && ativo(s));
    let faltam = esperando.length - (max - ficam.length);
    for (const v of ficam.filter((s) => s.status !== 'waiting').sort((a, b) => ordemNaRoda(b, a))) {
      if (faltam <= 0) break;
      individuais.delete(v.id);
      faltam--;
    }
    livres = max - ocupadas();
    for (const c of esperando) {
      if (livres <= 0) break;
      individuais.add(c.id);
      livres--;
    }
  }
  return { individuais, roda: subs.filter((s) => !individuais.has(s.id)).sort(ordemNaRoda) };
}

export interface RodaDaSala extends Record<EstadoNaRoda, number> {
  roomId: string;
  membros: AgentInfo[];
  /** Time de todos os membros, quando é um só. */
  time?: string;
  /** Quem disparou todos os membros, quando é um só. */
  parentId?: string;
}

/** Personagem do mundo, só no que a escolha precisa. */
export interface PersonagemEmCena {
  id: string;
  roomId: string;
  gone: boolean;
  info: { kind: AgentKind };
}

const VAZIO: ReadonlySet<string> = new Set();

/** Roda com estes membros (já em `ordemNaRoda`), contada por estado. */
export function montarRoda(roomId: string, membros: AgentInfo[]): RodaDaSala {
  const r: RodaDaSala = { roomId, membros, esperando: 0, trabalhando: 0, aToa: 0, concluido: 0 };
  for (const m of membros) r[estadoNaRoda(m.status)]++;
  const chave = chaveEquipe(membros[0]);
  if (membros[0].teamName && membros.every((m) => chaveEquipe(m) === chave)) r.time = membros[0].teamName;
  const pai = membros[0].parentId;
  if (pai && membros.every((m) => m.parentId === pai)) r.parentId = pai;
  return r;
}

/** Estado da escolha entre snapshots: quem é personagem e quem está em cada roda. */
export class Fanout {
  readonly rodas = new Map<string, RodaDaSala>();
  /** Sala cuja roda está com a lista aberta (clique na roda). */
  aberta: string | null = null;
  private individuais = new Set<string>();
  private salaDoMembro = new Map<string, string>();
  private vindosDaRoda = new Set<string>();

  /** Os agentes do snapshot que viram personagens (todos os principais e os subagentes escolhidos). */
  filtrar(agents: readonly AgentInfo[], personagens: Iterable<PersonagemEmCena>): AgentInfo[] {
    const emCena = new Set<string>();
    const emCenaPorSala = new Map<string, Set<string>>();
    for (const c of personagens) {
      if (c.gone || c.info.kind !== 'sub') continue;
      emCena.add(c.id);
      const s = emCenaPorSala.get(c.roomId);
      if (s) s.add(c.id);
      else emCenaPorSala.set(c.roomId, new Set([c.id]));
    }
    const porSala = new Map<string, AgentInfo[]>();
    for (const a of agents) {
      if (a.kind !== 'sub') continue;
      const l = porSala.get(a.roomId);
      if (l) l.push(a);
      else porSala.set(a.roomId, [a]);
    }
    const individuais = new Set<string>();
    const salaDoMembro = new Map<string, string>();
    this.rodas.clear();
    for (const [roomId, subs] of porSala) {
      const e = escolherIndividuais(subs, this.individuais, emCenaPorSala.get(roomId) ?? VAZIO);
      for (const id of e.individuais) individuais.add(id);
      if (!e.roda.length) continue;
      this.rodas.set(roomId, montarRoda(roomId, e.roda));
      for (const m of e.roda) salaDoMembro.set(m.id, roomId);
    }
    // sumiu do snapshot por um instante e o personagem ainda está aí: segue sendo ele
    for (const id of this.individuais) if (emCena.has(id) && !salaDoMembro.has(id)) individuais.add(id);
    this.vindosDaRoda.clear();
    for (const id of individuais) if (!this.individuais.has(id) && this.salaDoMembro.has(id)) this.vindosDaRoda.add(id);
    this.individuais = individuais;
    this.salaDoMembro = salaDoMembro;
    return agents.filter((a) => a.kind !== 'sub' || individuais.has(a.id));
  }

  /** Está na roda (sem personagem próprio, ou voltando para ela). */
  membro(id: string): boolean {
    return this.salaDoMembro.has(id);
  }

  rodaDe(id: string): RodaDaSala | undefined {
    const sala = this.salaDoMembro.get(id);
    return sala ? this.rodas.get(sala) : undefined;
  }

  /** Acabou de sair da roda para virar personagem: levanta de lá, sem passar pelo elevador. */
  saiDaRoda(id: string): boolean {
    return this.vindosDaRoda.has(id);
  }

  lugar(room: { layout: AreaLayout }): LugarDaRoda {
    return lugarDaRoda(room.layout);
  }
}
