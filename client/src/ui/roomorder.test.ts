import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveRoom, orderRooms } from './roomorder';

const KEY = 'expediente:ordem-salas';
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

const id = (s: string) => s;

describe('ordem das salas na lista lateral', () => {
  it('sem ordem guardada mantém a ordem recebida', () => {
    expect(orderRooms(['a', 'b'], id)).toEqual(['a', 'b']);
  });
  it('mover grava com a chave do Expediente, preserva salas fora da lista e põe as novas no fim', () => {
    data.set(KEY, JSON.stringify(['x', 'a', 'b']));
    expect(moveRoom(['a', 'b', 'c'], 'c', 'a', false)).toBe(true);
    expect(JSON.parse(data.get(KEY)!)).toEqual(['c', 'a', 'b', 'x']);
    expect(orderRooms(['n', 'b', 'c'], id)).toEqual(['c', 'b', 'n']);
  });
  it('recusa mover para si mesmo ou para sala fora da lista', () => {
    expect(moveRoom(['a', 'b'], 'a', 'a', true)).toBe(false);
    expect(moveRoom(['a', 'b'], 'a', 'z', true)).toBe(false);
  });
  it('valor guardado de outro formato não quebra a leitura', () => {
    for (const ruim of ['{oops', '{"a":1}', '"x"', '[1,null]']) {
      data.set(KEY, ruim);
      expect(orderRooms(['a', 'b'], id), ruim).toEqual(['a', 'b']);
    }
  });
});
