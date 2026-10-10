import { describe, expect, it } from 'vitest';
import { deveAgrupar, nomesDeQuemEspera } from './espera-aviso';

describe('aviso agrupado de quem espera', () => {
  it('um alerta fica sozinho; a partir de dois vira um aviso só', () => {
    expect(deveAgrupar(0)).toBe(false);
    expect(deveAgrupar(1)).toBe(false);
    expect(deveAgrupar(2)).toBe(true);
    expect(deveAgrupar(13)).toBe(true);
  });

  it('nomeia os primeiros e conta quantos ficaram de fora', () => {
    expect(nomesDeQuemEspera(['Jonas', 'Igor'])).toBe('Jonas, Igor');
    expect(nomesDeQuemEspera(['Jonas', 'Igor', 'Cecília'])).toBe('Jonas, Igor, Cecília');
    expect(nomesDeQuemEspera(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c e mais 2');
  });
});
