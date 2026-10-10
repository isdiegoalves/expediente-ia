import { describe, expect, it, vi } from 'vitest';
import esquema from '../../../shared/tema/tema.schema.json';
import { CHAVES_HALLOWEEN, CHAVES_NATAL, razao, rgbaDe, type Tema } from '../../../shared/tema/validar';
import { aplicarPaleta, variaveisCss } from './aplicar';
import { derivar } from './cores';
import { definirTema, problemasDoTema, sazonal, TEMA_PADRAO } from './index';

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

describe('cores sazonais do tema', () => {
  it('o padrão declara toda chave, em hexadecimal, e o schema exige exatamente as mesmas', () => {
    const { natal, halloween } = TEMA_PADRAO.paleta.sazonal!;
    expect(Object.keys(natal).sort()).toEqual([...CHAVES_NATAL].sort());
    expect(Object.keys(halloween).sort()).toEqual([...CHAVES_HALLOWEEN].sort());
    for (const cor of [...Object.values(natal), ...Object.values(halloween)]) expect(cor).toMatch(/^#[0-9a-f]{6}$/i);
    const exigidas = esquema.properties.paleta.properties.sazonal.properties;
    expect([...exigidas.natal.required].sort()).toEqual([...CHAVES_NATAL].sort());
    expect([...exigidas.halloween.required].sort()).toEqual([...CHAVES_HALLOWEEN].sort());
  });

  it('tema sem o bloco continua válido e usa as cores do padrão; bloco incompleto ou com cor ruim é recusado', () => {
    const t = padrao();
    delete t.paleta.sazonal;
    expect(problemasDoTema(t)).toEqual([]);
    definirTema(t, '/temas/padrao/');
    try {
      expect(sazonal()).toBe(TEMA_PADRAO.paleta.sazonal);
    } finally {
      definirTema(TEMA_PADRAO, '/temas/padrao/');
    }
    const faltando = padrao();
    delete (faltando.paleta.sazonal!.natal as Partial<Record<string, string>>).neve;
    expect(problemasDoTema(faltando)).not.toEqual([]);
    const ruim = padrao();
    ruim.paleta.sazonal!.halloween.teia = 'red';
    expect(problemasDoTema(ruim)).not.toEqual([]);
  });

  it('o tema ativo manda: trocar a cor do tema troca a cor da decoração', () => {
    const t = padrao();
    t.paleta.sazonal!.natal.tapete = '#010203';
    definirTema(t, '/temas/padrao/');
    try {
      expect(sazonal().natal.tapete).toBe('#010203');
    } finally {
      definirTema(TEMA_PADRAO, '/temas/padrao/');
    }
  });
});
