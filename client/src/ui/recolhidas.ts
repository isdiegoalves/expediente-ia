// Salas recolhidas na lista lateral: lembradas no navegador pelo id da sala (a pasta do projeto).
const KEY = 'expediente:salas-recolhidas';
const MAX = 100;

export function salasRecolhidas(): Set<string> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Recolhe ou expande a sala e devolve se ela ficou recolhida. */
export function alternarSala(id: string): boolean {
  const set = salasRecolhidas();
  const recolhida = !set.delete(id);
  if (recolhida) set.add(id);
  try {
    localStorage.setItem(KEY, JSON.stringify([...set].slice(-MAX)));
  } catch {
    // sem armazenamento: vale só até recarregar
  }
  return recolhida;
}
