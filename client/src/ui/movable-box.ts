export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Quanto da janela precisa continuar visível na tela. */
export const KEEP_VISIBLE = 80;
export const MIN_W = 300;
export const MIN_H = 160;

export function loadBox(key: string): Box | null {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Box> | null;
    if (v && [v.x, v.y, v.w, v.h].every((n) => typeof n === 'number' && Number.isFinite(n))) return v as Box;
  } catch {
    // sem armazenamento
  }
  return null;
}

export function saveBox(key: string, b: Box | null): void {
  try {
    if (b) localStorage.setItem(key, JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h) }));
    else localStorage.removeItem(key);
  } catch {
    // sem armazenamento
  }
}

/** Mantém um pedaço da janela (e a barra, abaixo de `minTop`) dentro da tela. */
export function fitBox(b: Box, view: { w: number; h: number }, minTop: number): Box {
  const w = Math.max(MIN_W, Math.min(b.w, view.w));
  const x = Math.min(view.w - KEEP_VISIBLE, Math.max(KEEP_VISIBLE - w, b.x));
  // O limite de cima vence o de baixo: numa janela baixa demais, a barra continua alcançável.
  const y = Math.max(minTop, Math.min(view.h - MIN_H, b.y));
  // A altura encolhe para a janela não passar da borda de baixo.
  const h = Math.max(MIN_H, Math.min(b.h, view.h - y - 8));
  return { x, y, w, h };
}
