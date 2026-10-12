// Contas de cor em #rrggbb e #rrggbbaa; o formato válido é o do schema, aqui só se calcula.
export const rgbDe = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
export const alfaDe = (hex) => (hex.length === 9 ? hex.slice(7) : '');
const hex2 = (n) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, '0');
export const hexDe = ([r, g, b], alfa = '') => `#${hex2(r)}${hex2(g)}${hex2(b)}${alfa}`;

/** `t` de `b` sobre `a` (0 = a, 1 = b); o alfa de `a` se mantém. */
export const misturar = (a, b, t) => {
  const [x, y] = [rgbDe(a), rgbDe(b)];
  return hexDe(x.map((v, i) => v + (y[i] - v) * t), alfaDe(a));
};

export function paraHsl(hex) {
  const [r, g, b] = rgbDe(hex).map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}

export function deHsl([h, s, l], alfa = '') {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return hexDe([(r + m) * 255, (g + m) * 255, (b + m) * 255], alfa);
}
