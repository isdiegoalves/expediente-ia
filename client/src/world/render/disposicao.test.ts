// Disposição dos balões: o lugar escolhido nunca cobre o que já está na tela.
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../../../../shared/hash';
import { lugarDoBalao, Ocupacao, sobrepoe, type Caixa } from './disposicao';

describe('lugar do balão', () => {
  it('livre: fica no lugar normal, centrado na cabeça e acima da base', () => {
    const o = new Ocupacao();
    const l = lugarDoBalao({ cx: 200, base: 100, w: 80, h: 20, degraus: 0 }, 1000, (x, y, w, h) => o.livre(x, y, w, h));
    expect(l).toEqual({ x: 160, y: 80, w: 80, h: 20, chip: false, degraus: 0 });
  });

  it('balão comum que não cabe vira só o ícone; sem lugar nem assim, some', () => {
    const o = new Ocupacao();
    o.ocupar(150, 80, 100, 20);
    const livre = (x: number, y: number, w: number, h: number) => o.livre(x, y, w, h);
    expect(lugarDoBalao({ cx: 200, base: 100, w: 80, h: 20, chip: { w: 24, h: 20 }, degraus: 0 }, 1000, livre)).toBeNull();
    const o2 = new Ocupacao();
    o2.ocupar(120, 80, 60, 20);
    const l = lugarDoBalao({ cx: 200, base: 100, w: 80, h: 20, chip: { w: 24, h: 20 }, degraus: 0 }, 1000, (x, y, w, h) => o2.livre(x, y, w, h));
    expect(l).toMatchObject({ x: 188, w: 24, chip: true });
  });

  it('alerta sobe um degrau e, sem espaço no meio, anda para o lado; nunca fica por cima', () => {
    const o = new Ocupacao();
    o.ocupar(150, 80, 100, 20);
    o.ocupar(150, 54, 100, 20);
    const l = lugarDoBalao({ cx: 200, base: 100, w: 80, h: 20, chip: { w: 24, h: 20 }, degraus: 3 }, 1000, (x, y, w, h) => o.livre(x, y, w, h));
    expect(l).not.toBeNull();
    expect(o.livre(l!.x, l!.y, l!.w, l!.h)).toBe(true);
    expect(l!.chip).toBe(false);
  });

  it('não sai da tela', () => {
    const l = lugarDoBalao({ cx: 5, base: 100, w: 80, h: 20, degraus: 0 }, 300, () => true);
    expect(l!.x).toBe(4);
    const r = lugarDoBalao({ cx: 298, base: 100, w: 80, h: 20, degraus: 0 }, 300, () => true);
    expect(r!.x + r!.w).toBe(296);
  });

  it('em trezentas telas cheias, cada balão posto fica livre de todos os anteriores', () => {
    const rng = mulberry32(42);
    let sobrepostos = 0;
    let postosNoTotal = 0;
    for (let tela = 0; tela < 300; tela++) {
      const o = new Ocupacao();
      const postos: Caixa[] = [];
      for (let i = 0; i < 40; i++) {
        const alerta = rng() < 0.3;
        const l = lugarDoBalao(
          { cx: rng() * 800, base: 40 + rng() * 500, w: 30 + rng() * 200, h: 20, chip: { w: 24, h: 20 }, degraus: alerta ? 3 : 0 },
          800,
          (x, y, w, h) => o.livre(x, y, w, h),
        );
        if (!l) continue;
        for (const p of postos) if (sobrepoe(l, p)) sobrepostos++;
        o.ocupar(l.x, l.y, l.w, l.h);
        postos.push(l);
      }
      postosNoTotal += postos.length;
    }
    expect(sobrepostos).toBe(0);
    expect(postosNoTotal).toBeGreaterThan(300 * 15);
  });
});
