import { describe, expect, it, vi } from 'vitest';
import { razao, rgbaDe, type Tema } from '../../../shared/tema/validar';
import { aplicarPaleta, variaveisCss } from './aplicar';
import { derivar } from './cores';
import { problemasDoTema, TEMA_PADRAO } from './index';

const padrao = (): Tema => structuredClone(TEMA_PADRAO);
const rgb = (hex: string) => {
  const c = rgbaDe(hex);
  if (!c) throw new Error(`cor ilegível: ${hex}`);
  return c;
};
/** Compõe `fg` (com alpha) sobre `bg` opaco. */
const sobre = (fg: string, bg: string) => {
  const [r, g, b, a] = rgb(fg);
  const [br, bgg, bb] = rgb(bg);
  return [r * a + br * (1 - a), g * a + bgg * (1 - a), b * a + bb * (1 - a), 1] as [number, number, number, number];
};

describe('variáveis CSS do tema', () => {
  it('escreve os 22 tokens, todos em hexadecimal', () => {
    const vars = variaveisCss(padrao());
    expect(vars).toHaveLength(22);
    for (const [, cor] of vars) expect(cor).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
  });

  it('só escreve cor que passa na conferência do padrão hexadecimal', () => {
    const t = padrao();
    t.paleta.ui.texto = 'url(javascript:alert(1))';
    const setProperty = vi.fn();
    aplicarPaleta(t, { style: { setProperty } } as unknown as HTMLElement);
    expect(setProperty).toHaveBeenCalledTimes(21);
    expect(setProperty.mock.calls.map((c) => c[0])).not.toContain('--ui-text');
  });

  it('o padrão e um tema com paleta trocada passam na conferência do navegador', () => {
    expect(problemasDoTema(padrao())).toEqual([]);
    const t = padrao();
    t.paleta.ui.texto = '#2a2f3a';
    expect(problemasDoTema(t)).not.toEqual([]);
  });
});

describe('cores do canvas derivadas dos tokens', () => {
  it('texto dos balões tem 4,5:1 sobre o fundo de cada tom', () => {
    const { balao } = derivar(padrao());
    for (const [tom, { fundo, texto }] of Object.entries(balao)) {
      expect(razao(rgb(texto), rgb(fundo)), tom).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('nome na etiqueta tem 4,5:1 sobre o fundo composto, em qualquer estado', () => {
    const t = padrao();
    const { etiqueta } = derivar(t);
    const chao = t.paleta.piso.azulejo[2];
    for (const fundo of [etiqueta.normal, etiqueta.espera, etiqueta.selecionada]) {
      expect(razao(rgb(t.paleta.canvas.rotuloTexto), sobre(fundo, chao))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('acompanha a paleta: trocar o status esperando muda o balão de alerta', () => {
    const t = padrao();
    t.paleta.status.esperando = '#ff00aa';
    expect(derivar(t).balao.alert.fundo).not.toBe(derivar(padrao()).balao.alert.fundo);
  });
});
