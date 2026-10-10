import { describe, expect, it } from 'vitest';
import type { SessaoResumo } from '../../../shared/resumo';
import { ausenciaDoMock, ausenciaTexto, MAX_LINHAS, maiorQueCabe, recortar } from './resumo-model';

const sessao = (id: string): SessaoResumo => ({ id, nome: id, sala: 'loja', estado: 'trabalhando', desde: 0 });

describe('resumo: o que a janela desenha', () => {
  it('só mostra as linhas que cabem e diz quantas ficaram de fora', () => {
    const todas = Array.from({ length: 10 }, (_, i) => sessao(`s${i}`));
    const { visiveis, restantes } = recortar(todas, 7);
    expect(visiveis).toHaveLength(7);
    expect(restantes).toBe(3);
    expect(recortar(todas.slice(0, 2), 7)).toEqual({ visiveis: todas.slice(0, 2), restantes: 0 });
  });

  it('reduz as linhas até a janela caber, sem passar do máximo nem de 1', () => {
    expect(maiorQueCabe(MAX_LINHAS, () => true)).toBe(MAX_LINHAS);
    expect(maiorQueCabe(MAX_LINHAS, (n) => n <= 5)).toBe(5);
    expect(maiorQueCabe(MAX_LINHAS, () => false)).toBe(1);
    expect(maiorQueCabe(0, () => true)).toBe(1);
  });

  it('o texto da ausência diz há quanto tempo você saiu', () => {
    expect(ausenciaTexto({ desde: 0, agora: 2 * 3_600_000 }, true)).toBe('Você saiu há 2 h');
    expect(ausenciaTexto({ desde: 0, agora: 90 * 60_000 }, false)).toBe('Desde que esta página abriu, há 1 h 30 min');
  });

  it('?resumo= do simulador aceita horas e minutos e ignora o resto', () => {
    expect(ausenciaDoMock('2h')).toBe(7_200_000);
    expect(ausenciaDoMock('90m')).toBe(5_400_000);
    expect(ausenciaDoMock('2 dias')).toBeUndefined();
    expect(ausenciaDoMock(null)).toBeUndefined();
  });
});
