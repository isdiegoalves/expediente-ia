import { describe, expect, it } from 'vitest';
import type { PresencaResposta } from '../../../shared/resumo';
import { PresencaDaAba } from './presenca';

function cenario(respostas: Array<PresencaResposta | null>) {
  const enviados: Array<[string, boolean]> = [];
  const ouvintes = new Map<string, () => void>();
  const alvo = { addEventListener: (t: string, fn: () => void) => void ouvintes.set(t, fn) };
  const documento = { hidden: false, ...alvo };
  const janela = { ...alvo };
  const recebidas: PresencaResposta[] = [];
  const presenca = new PresencaDaAba(
    async (aba, visivel) => {
      enviados.push([aba, visivel]);
      return respostas.shift() ?? null;
    },
    'aba-1',
    documento,
    janela,
    (r) => recebidas.push(r),
  );
  return { presenca, enviados, recebidas, documento, ouvintes };
}

const tick = () => new Promise((ok) => setTimeout(ok, 0));

describe('presença da aba', () => {
  it('ao ligar diz que está visível e entrega a resposta, inclusive o pedido de abrir o resumo', async () => {
    const c = cenario([{ saiuEm: 10, mostrar: true }]);
    c.presenca.start();
    await tick();
    expect(c.enviados).toEqual([['aba-1', true]]);
    expect(c.recebidas).toEqual([{ saiuEm: 10, mostrar: true }]);
  });

  it('ficar oculta e fechar a página avisam que saiu; voltar a ficar visível avisa de novo', async () => {
    const c = cenario([{ saiuEm: null, mostrar: false }, { saiuEm: 5, mostrar: false }, { saiuEm: 5, mostrar: false }, { saiuEm: 5, mostrar: true }]);
    c.presenca.start();
    await tick();
    c.documento.hidden = true;
    c.ouvintes.get('visibilitychange')!();
    await tick();
    c.ouvintes.get('pagehide')!();
    c.documento.hidden = false;
    c.ouvintes.get('visibilitychange')!();
    await tick();
    expect(c.enviados).toEqual([
      ['aba-1', true],
      ['aba-1', false],
      ['aba-1', false],
      ['aba-1', true],
    ]);
    expect(c.recebidas.at(-1)).toEqual({ saiuEm: 5, mostrar: true });
  });

  it('a resposta de quando a aba ficou oculta não abre nada, e servidor fora do ar é silêncio', async () => {
    const c = cenario([{ saiuEm: 7, mostrar: true }, null]);
    c.documento.hidden = true;
    await c.presenca.avisar();
    c.documento.hidden = false;
    await c.presenca.avisar();
    expect(c.recebidas).toEqual([]);
  });
});
