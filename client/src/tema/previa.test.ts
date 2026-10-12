import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tema } from '../../../shared/tema/validar';
import { semFaixa, textoDaPrevia } from '../ui/previa';
import { carregarTema, definirTema, tema, TEMA_PADRAO, urlDoTema } from './index';

const candidato = (id = 'aurora'): Tema => ({ ...structuredClone(TEMA_PADRAO), id, nome: 'Aurora Ficticia' });

function servidor(corpo: Record<string, unknown>, status = 200) {
  const fetchFalso = vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
  vi.stubGlobal('fetch', fetchFalso);
  return fetchFalso;
}

afterEach(() => {
  vi.unstubAllGlobals();
  definirTema(TEMA_PADRAO, '/temas/padrao/');
});

describe('carregar o tema na página', () => {
  it('sem ?tema pede o tema ativo e nada muda: sem prévia, tema do servidor aplicado', async () => {
    const f = servidor({ id: 'padrao', base: '/temas/padrao/', tema: TEMA_PADRAO, chave: 'padrao|' });
    const r = await carregarTema('?mock=1&sessions=5');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]).toEqual(['/api/tema', { cache: 'no-store' }]);
    expect(r).toEqual({ aviso: undefined, chave: 'padrao|' });
    expect(tema().id).toBe('padrao');
  });

  it('?tema=<id> pede a prévia, aplica o candidato só nesta aba e marca a prévia', async () => {
    const f = servidor({ id: 'aurora', base: '/temas/aurora/', tema: candidato(), previa: true, chave: 'padrao|' });
    const r = await carregarTema('?mock=1&tema=aurora');
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]).toEqual(['/api/tema?previa=aurora', { cache: 'no-store' }]);
    expect(r.previa).toBe(true);
    expect(r.chave).toBe('padrao|');
    expect(tema().id).toBe('aurora');
    expect(urlDoTema('brand/signage.png')).toBe('/temas/aurora/brand/signage.png');
  });

  it('previa que não é exatamente true não marca prévia', async () => {
    servidor({ id: 'aurora', base: '/temas/aurora/', tema: candidato(), previa: 'false', chave: 'padrao|' });
    expect((await carregarTema('?tema=aurora')).previa).toBeUndefined();
  });

  it('a prévia só lê: um único GET, sem método de escrita nem corpo', async () => {
    const f = servidor({ id: 'aurora', base: '/temas/aurora/', tema: candidato(), previa: true, chave: 'padrao|' });
    await carregarTema('?tema=aurora');
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBeUndefined();
    expect(init.body).toBeUndefined();
  });

  it('o valor de ?tema vai codificado, sem escapar da consulta', async () => {
    const f = servidor({ id: 'padrao', base: '/temas/padrao/', tema: TEMA_PADRAO, aviso: 'Prévia recusada', chave: 'padrao|' });
    await carregarTema('?tema=../x%26previa%3Dpadrao');
    expect((f.mock.calls[0] as unknown[])[0]).toBe('/api/tema?previa=..%2Fx%26previa%3Dpadrao');
  });

  it('prévia recusada pelo servidor: segue no tema ativo, mostra o aviso e não marca prévia', async () => {
    servidor({ id: 'padrao', base: '/temas/padrao/', tema: TEMA_PADRAO, aviso: 'Prévia recusada: tema "x": pasta do tema ausente', chave: 'padrao|' });
    const r = await carregarTema('?tema=x');
    expect(r.previa).toBeUndefined();
    expect(r.aviso).toMatch(/Prévia recusada/);
    expect(tema().id).toBe('padrao');
  });

  it('candidato que o navegador também reprova no contraste não vira prévia', async () => {
    const ruim = candidato();
    ruim.paleta.ui.texto = '#2a2f3a';
    servidor({ id: 'aurora', base: '/temas/aurora/', tema: ruim, previa: true, chave: 'padrao|' });
    const r = await carregarTema('?tema=aurora');
    expect(r.previa).toBeUndefined();
    expect(r.aviso).toMatch(/recusado pelo navegador/);
    expect(tema().id).toBe('padrao');
  });

  it('base fora do formato do servidor não troca o tema', async () => {
    servidor({ id: 'aurora', base: 'https://outro.exemplo/', tema: candidato(), previa: true, chave: 'padrao|' });
    const r = await carregarTema('?tema=aurora');
    expect(r.previa).toBeUndefined();
    expect(tema().id).toBe('padrao');
  });

  it('servidor fora do ar ou com erro: segue no padrão sem prévia', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('sem rede'))));
    expect(await carregarTema('?tema=aurora')).toEqual({});
    servidor({ error: 'x' }, 500);
    expect(await carregarTema('?tema=aurora')).toEqual({});
  });
});

describe('faixa de prévia', () => {
  it('diz o nome do tema, que é só desta aba e como aprovar ou recusar', () => {
    const texto = textoDaPrevia('Aurora Ficticia');
    expect(texto).toContain('"Aurora Ficticia"');
    expect(texto).toMatch(/só nesta aba/);
    expect(texto).toMatch(/aprovar ou recusar/);
  });
});

describe('faixa nas capturas', () => {
  it('?faixa=0 esconde a faixa; qualquer outra coisa não', () => {
    expect(semFaixa('?mock=1&faixa=0&sala=1&tema=x')).toBe(true);
    for (const q of ['', '?tema=x', '?faixa=1', '?faixa=', '?faixa=00', '?faixa=false']) expect(semFaixa(q), q).toBe(false);
  });
});
