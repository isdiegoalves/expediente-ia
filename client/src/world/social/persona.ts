// Personalidades: o núcleo (traços, vínculos) é compartilhado com a agenda do servidor
// (shared/social/persona.ts); aqui ficam só os pesos dos passeios sozinho, que são do navegador.
import { type Persona, type TraitId } from '../../../../shared/social/persona';
import { IDLE_WEIGHTS, type IdleActivity } from '../sim/behavior';

export * from '../../../../shared/social/persona';

/** Quanto cada traço multiplica a vontade de cada passeio sozinho. */
const SOLO_K: Partial<Record<TraitId, Partial<Record<IdleActivity, number>>>> = {
  cafeina: { coffee: 3 },
  vaidade: { mirror: 5, bathroom: 1.3 },
  leitura: { shelf: 3, phone: 1.6, window: 1.2 },
  sonecas: { lounge: 2.5 },
  esporte: { stretch: 2.5, water: 1.5 },
  calma: { window: 2.5, stretch: 1.5 },
  games: { arcade: 3, phone: 1.4 },
  timidez: { window: 1.5, shelf: 1.5, phone: 1.5 },
  fofoca: { coffee: 1.4, phone: 1.4 },
  series: { phone: 1.5, lounge: 1.3 },
  economia: { snack: 0.4, water: 1.6 },
};

/** Pesos dos passeios sozinho para esta personalidade. */
export function soloWeights(p: Persona): Record<IdleActivity, number> {
  const out = { ...IDLE_WEIGHTS };
  for (const t of p.traits) for (const [k, v] of Object.entries(SOLO_K[t] ?? {})) out[k as IdleActivity] *= v as number;
  return out;
}
