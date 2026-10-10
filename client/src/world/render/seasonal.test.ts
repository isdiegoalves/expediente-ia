import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FurnitureKind, WallStyle } from '../../art/api';
import type { AreaLayout } from '../layout/types';
import { drawSeasonalWindow, seasonalCostume, seasonalFurniture, seasonalRugColor, seasonalWallStyle } from './seasonal';

const SEMEADO = [0, 1, 2, 3, 41, 99999, 4294967295];

function ctxFalso() {
  const chamadas: number[][] = [];
  const ctx = {
    save() {},
    restore() {},
    beginPath() {},
    rect() {},
    clip() {},
    fillStyle: '',
    globalAlpha: 1,
    fillRect: (...a: number[]) => void chamadas.push(a),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, chamadas };
}

afterEach(() => vi.unstubAllGlobals());

describe('decoração sazonal: aparência, não geometria', () => {
  it('o padrão não veste ninguém, o Natal veste todos de gorro e o Halloween escolhe uma fantasia estável por semente', () => {
    for (const seed of SEMEADO) {
      expect(seasonalCostume('auto', seed)).toBeUndefined();
      expect(seasonalCostume('christmas', seed)).toBe('santa');
      const fantasia = seasonalCostume('halloween', seed);
      expect(['witch', 'pumpkin', 'vampire']).toContain(fantasia);
      expect(seasonalCostume('halloween', seed)).toBe(fantasia);
    }
  });

  it('tapete e parede só trocam de cor: o padrão devolve o original e o vidro nunca é tingido', () => {
    const parede: WallStyle = { base: '#d9dcdf', trim: '#8d969e', pattern: 'marble' };
    const vidro: WallStyle = { base: '#aabbcc', trim: '#334455', pattern: 'glass' };
    expect(seasonalRugColor('auto', '#123456')).toBe('#123456');
    expect(seasonalRugColor('christmas', '#123456')).not.toBe('#123456');
    expect(seasonalRugColor('halloween', '#123456')).not.toBe(seasonalRugColor('christmas', '#123456'));
    expect(seasonalWallStyle('auto', parede)).toBe(parede);
    expect(seasonalWallStyle('christmas', vidro)).toBe(vidro);
    for (const tema of ['christmas', 'halloween'] as const) {
      const novo = seasonalWallStyle(tema, parede);
      expect(novo.pattern).toBe(parede.pattern);
      expect(novo.base).not.toBe(parede.base);
    }
  });

  it('só as plantas trocam de sprite; nenhum outro móvel, nem o banheiro, é substituído', () => {
    const sala = { kind: 'room', furniture: [] } as unknown as AreaLayout;
    const banheiro = { kind: 'restroom', furniture: [] } as unknown as AreaLayout;
    const outros: FurnitureKind[] = ['desk', 'office_chair', 'bookshelf', 'meeting_table', 'water_cooler', 'floor_lamp', 'stool'];
    for (const tema of ['christmas', 'halloween'] as const) {
      for (const kind of outros) expect(seasonalFurniture(tema, kind, sala, 7), `${tema} ${kind}`).toBeNull();
      for (const kind of ['plant_small', 'plant_tall'] as const) expect(seasonalFurniture(tema, kind, banheiro, 7)).toBeNull();
    }
    expect(seasonalFurniture('auto', 'plant_small', sala, 7)).toBeNull();
    expect(seasonalFurniture('auto', 'plant_tall', sala, 7)).toBeNull();
  });
});

describe('neve na janela do Natal', () => {
  const mq = { matches: false };
  const vidro = { x: 10, y: 10, w: 40, h: 30 };

  function neve(tema: 'auto' | 'christmas' | 'halloween', now: number, reduzido: boolean) {
    mq.matches = reduzido;
    vi.stubGlobal('matchMedia', () => mq);
    const { ctx, chamadas } = ctxFalso();
    drawSeasonalWindow(ctx, tema, vidro, now, 5);
    return chamadas;
  }

  it('só o Natal desenha, e a neve cai com o tempo', () => {
    expect(neve('auto', 0, false)).toEqual([]);
    expect(neve('halloween', 0, false)).toEqual([]);
    expect(neve('christmas', 0, false).length).toBeGreaterThan(0);
    expect(neve('christmas', 0, false)).not.toEqual(neve('christmas', 5000, false));
  });

  it('com movimento reduzido a neve fica parada', () => {
    expect(neve('christmas', 0, true)).toEqual(neve('christmas', 5000, true));
    expect(neve('christmas', 0, true).length).toBeGreaterThan(0);
  });
});
