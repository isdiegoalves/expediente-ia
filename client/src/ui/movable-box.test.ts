import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fitBox, KEEP_VISIBLE, loadBox, MIN_H, MIN_W, saveBox } from './movable-box';

const KEY = 'expediente.move.drawer';
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('lugar guardado da janela móvel', () => {
  it('guarda arredondado e lê de volta', () => {
    saveBox(KEY, { x: 10.4, y: 20.6, w: 400, h: 300 });
    expect(JSON.parse(data.get(KEY)!)).toEqual({ x: 10, y: 21, w: 400, h: 300 });
    expect(loadBox(KEY)).toEqual({ x: 10, y: 21, w: 400, h: 300 });
  });

  it('guardar null esquece o lugar', () => {
    saveBox(KEY, { x: 1, y: 2, w: 400, h: 300 });
    saveBox(KEY, null);
    expect(data.has(KEY)).toBe(false);
    expect(loadBox(KEY)).toBeNull();
  });

  it('valor de outro formato volta a nada em vez de quebrar', () => {
    for (const v of ['', 'não é json', 'null', '5', '[]', '{"x":"a","y":1,"w":2,"h":3}', '{"x":1,"y":1,"w":2}', '{"x":1,"y":1,"w":2,"h":null}', '{"x":1e999,"y":1,"w":2,"h":3}']) {
      data.set(KEY, v);
      expect(loadBox(KEY), v).toBeNull();
    }
  });

  it('sem localStorage não quebra', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => {
        throw new Error('bloqueado');
      },
    });
    expect(loadBox(KEY)).toBeNull();
    expect(() => saveBox(KEY, { x: 1, y: 1, w: 400, h: 300 })).not.toThrow();
    expect(() => saveBox(KEY, null)).not.toThrow();
  });
});

describe('encaixe da janela móvel na tela', () => {
  const view = { w: 1200, h: 800 };
  const top = 60;

  it('janela inteira dentro da tela fica como está', () => {
    expect(fitBox({ x: 100, y: 100, w: 400, h: 300 }, view, top)).toEqual({ x: 100, y: 100, w: 400, h: 300 });
  });

  it('janela longe, para cima e à esquerda, volta mostrando a barra e um pedaço', () => {
    const b = fitBox({ x: -99999, y: -99999, w: 10, h: 10 }, view, top);
    expect(b).toEqual({ x: KEEP_VISIBLE - MIN_W, y: top, w: MIN_W, h: MIN_H });
  });

  it('janela longe, para baixo e à direita, mantém um pedaço visível', () => {
    const b = fitBox({ x: 99999, y: 99999, w: 400, h: 300 }, view, top);
    expect(b.x).toBe(view.w - KEEP_VISIBLE);
    expect(b.y).toBe(view.h - MIN_H);
    expect(b.h).toBe(MIN_H);
  });

  it('não passa da borda de baixo nem da largura da tela', () => {
    const b = fitBox({ x: 0, y: 500, w: 5000, h: 5000 }, view, top);
    expect(b.w).toBe(view.w);
    expect(b.y + b.h).toBeLessThanOrEqual(view.h - 8);
  });

  it('tela estreita: largura e altura mínimas vencem, e a barra continua abaixo do topo', () => {
    const b = fitBox({ x: 0, y: 0, w: 900, h: 900 }, { w: 200, h: 120 }, top);
    expect(b.w).toBe(MIN_W);
    expect(b.h).toBe(MIN_H);
    expect(b.y).toBe(top);
  });
});
