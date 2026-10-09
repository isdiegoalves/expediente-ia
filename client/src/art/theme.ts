// Temas de sala (puros): vêm de `paleta.salas` do tema ativo. Sementes consecutivas (slots vizinhos)
// recebem temas diferentes; a ordem da lista alterna famílias de cor de propósito.
import { tema } from '../tema';
import type { RoomTheme } from './api';

const THEMES: readonly RoomTheme[] = tema().paleta.salas.map((s) => ({
  carpet: s.tapete,
  carpet2: s.tapete2,
  wall: { base: s.parede.base, trim: s.parede.friso, pattern: s.parede.padrao as RoomTheme['wall']['pattern'] },
  accent: s.destaque,
  deskVariant: s.mesa,
  chairVariant: s.cadeira,
}));

export const THEME_COUNT = THEMES.length;

export function roomTheme(seed: number): RoomTheme {
  const n = THEMES.length;
  const t = THEMES[((Math.floor(seed) % n) + n) % n];
  return { ...t, wall: { ...t.wall } };
}
