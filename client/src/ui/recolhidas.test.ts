import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { alternarSala, salasRecolhidas } from './recolhidas';

const KEY = 'expediente:salas-recolhidas';
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('salas recolhidas', () => {
  it('alterna e lembra', () => {
    expect(alternarSala('a')).toBe(true);
    expect(alternarSala('b')).toBe(true);
    expect([...salasRecolhidas()]).toEqual(['a', 'b']);
    expect(alternarSala('a')).toBe(false);
    expect(JSON.parse(data.get(KEY)!)).toEqual(['b']);
  });

  it('valor guardado de outro formato não quebra a leitura', () => {
    for (const ruim of ['{oops', '{"a":1}', '"x"']) {
      data.set(KEY, ruim);
      expect(salasRecolhidas().size, ruim).toBe(0);
    }
    data.set(KEY, '[1,"a",null]');
    expect([...salasRecolhidas()]).toEqual(['a']);
  });
});
