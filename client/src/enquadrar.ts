// `?sala=<n>`: enquadra a n-ésima sala de projeto assim que o escritório a mostra. Serve às capturas da prévia do tema.
import type { RoomInfo } from '../../shared/types';

/** O número pedido em `?sala=` (inteiro de 1 a 20), ou null. */
export function salaPedida(search: string): number | null {
  const n = Number(new URLSearchParams(search).get('sala'));
  return Number.isInteger(n) && n >= 1 && n <= 20 ? n : null;
}

/** A n-ésima sala (a partir de 1) na ordem das vagas do prédio. */
export function salaPelaOrdem(salas: readonly RoomInfo[], n: number): RoomInfo | undefined {
  return [...salas].sort((a, b) => a.slot - b.slot)[n - 1];
}
