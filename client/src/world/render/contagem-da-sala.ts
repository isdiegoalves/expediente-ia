// Contagens por sala com a roda da equipe: quantos estão na sala (a pílula) e quem espera você (o balão da visão
// geral). Puro: quem tem personagem conta pelo personagem; quem está só na roda, pela roda.
import type { RodaDaSala } from '../sim/fanout';

/** Personagem do mundo, só no que a contagem precisa. */
export interface PersonagemNaSala {
  roomId: string;
  leaving: boolean;
  mode: string;
}

/** Os personagens da sala que não estão indo embora e quem está na roda dela sem personagem próprio. */
export function pessoasNaSala(roomId: string, personagens: ReadonlyMap<string, PersonagemNaSala>, roda: RodaDaSala | undefined): number {
  let n = 0;
  for (const m of roda?.membros ?? []) if (!personagens.has(m.id)) n++;
  for (const c of personagens.values()) if (c.roomId === roomId && !c.leaving) n++;
  return n;
}

export interface QuemEspera {
  id: string;
  roomId: string;
  /** Só quem está à vista serve de apoio para o balão da sala. */
  visivel: boolean;
}

/** Os personagens esperando você e quem espera dentro das rodas, que conta para a sala sem servir de apoio ao balão. */
export function quemEspera(personagens: ReadonlyMap<string, PersonagemNaSala>, rodas: Iterable<RodaDaSala>, aVista: (id: string) => boolean): QuemEspera[] {
  const out: QuemEspera[] = [];
  for (const [id, c] of personagens) if (c.mode === 'wait' && !c.leaving) out.push({ id, roomId: c.roomId, visivel: aVista(id) });
  for (const r of rodas) {
    if (!r.esperando) continue;
    for (const m of r.membros) if (m.status === 'waiting' && !personagens.has(m.id)) out.push({ id: m.id, roomId: r.roomId, visivel: false });
  }
  return out;
}
