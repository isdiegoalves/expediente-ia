import { utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { custoDaMensagem, janelaDoModelo, precoDoModelo, tabelaAtual, usarArquivoDoDono, type UsoBruto } from './precos';

setQuiet(true);

const uso = (o: Partial<UsoBruto> = {}): UsoBruto => ({ entrada: 0, saida: 0, leituraCache: 0, escritaCache: 0, escritaCache1h: 0, buscas: 0, ...o });

afterEach(() => usarArquivoDoDono(undefined));

describe('custoDaMensagem', () => {
  it('soma entrada, saída, leitura de cache e escrita de cache (5 min e 1 h) pela tarifa do modelo', () => {
    // claude-opus-5: 5 / 25 / leitura 0,5 / escrita 6,25 (5 min) e 10 (1 h) por milhão.
    const c = custoDaMensagem('claude-opus-5', uso({ entrada: 1000, saida: 2000, leituraCache: 100_000, escritaCache: 10_000, escritaCache1h: 4000 }));
    expect(c).toBeCloseTo(0.005 + 0.05 + 0.05 + 0.04 + 0.0375, 10);
  });

  it('a parte de 1 h da escrita nunca passa do total escrito', () => {
    const c = custoDaMensagem('claude-opus-5', uso({ escritaCache: 1_000_000, escritaCache1h: 9_000_000 }));
    expect(c).toBeCloseTo(10, 10);
  });

  it('processamento nos EUA custa 10% a mais nos tokens, não nas buscas', () => {
    const base = uso({ entrada: 1_000_000, buscas: 2 });
    expect(custoDaMensagem('claude-opus-5', base)).toBeCloseTo(5 + 0.02, 10);
    expect(custoDaMensagem('claude-opus-5', { ...base, geo: 'us' })).toBeCloseTo(5.5 + 0.02, 10);
  });

  it('prompt acima do limite usa a tarifa longa do modelo que tem uma', () => {
    const curto = custoDaMensagem('claude-haiku-5-5', uso({ entrada: 50_000 }));
    const longo = custoDaMensagem('claude-haiku-5-5', uso({ entrada: 50_000, leituraCache: 100_000 }));
    expect(curto).toBeCloseTo(0.005, 10);
    expect(longo).toBeCloseTo(0.025 + 0.005, 10);
  });

  it('modelo sem preço na tabela: undefined, nunca zero', () => {
    expect(custoDaMensagem('Qwen3.8-27B-4bit', uso({ entrada: 1000 }))).toBeUndefined();
  });

  it('reconhece o id datado, o sufixo [1m] e maiúsculas', () => {
    expect(precoDoModelo('claude-haiku-4-5-20251001')).toBe(precoDoModelo('claude-haiku-4-5'));
    expect(precoDoModelo('claude-opus-5[1m]')).toBe(precoDoModelo('claude-opus-5'));
    expect(precoDoModelo('Claude-Opus-5')).toBe(precoDoModelo('claude-opus-5'));
    expect(precoDoModelo('claude-opus-5')).toBeDefined();
  });

  it('id herdado de Object.prototype não é modelo', () => {
    expect(precoDoModelo('constructor')).toBeUndefined();
    expect(precoDoModelo('__proto__')).toBeUndefined();
  });
});

describe('janelaDoModelo', () => {
  it('janela da tabela; modelo claude-* fora dela usa a padrão; outra origem não tem janela', () => {
    expect(janelaDoModelo('claude-opus-5', 10)).toBe(1_000_000);
    expect(janelaDoModelo('claude-sonnet-4-6', 10)).toBe(200_000);
    expect(janelaDoModelo('claude-modelo-novo-9', 10)).toBe(200_000);
    expect(janelaDoModelo('Qwen3.8-27B-4bit', 10)).toBeUndefined();
  });

  it('contexto acima da janela da tabela só cabe na janela estendida (o transcript não traz o sufixo [1m])', () => {
    expect(janelaDoModelo('claude-sonnet-4-6', 200_000)).toBe(200_000);
    expect(janelaDoModelo('claude-sonnet-4-6', 200_001)).toBe(1_000_000);
  });
});

describe('arquivo de preços do dono', () => {
  const escreve = (dir: string, conteudo: unknown): string => {
    const f = join(dir, 'precos.json');
    writeFileSync(f, JSON.stringify(conteudo));
    return f;
  };
  const tarifa = { entrada: 1, saida: 2, escritaCache5m: 3, escritaCache1h: 4, leituraCache: 5, busca: 6 };

  it('acrescenta modelo, troca preço de modelo conhecido e mantém o resto da tabela padrão', () => {
    const tmp = tempDir();
    try {
      usarArquivoDoDono(escreve(tmp.dir, { modelos: { 'meu-modelo': { ...tarifa, janela: 32_000 }, 'claude-opus-5': { saida: 99 } } }));
      expect(tabelaAtual().modelos['meu-modelo']).toMatchObject({ entrada: 1, janela: 32_000 });
      expect(precoDoModelo('claude-opus-5')).toMatchObject({ entrada: 5, saida: 99 });
      expect(precoDoModelo('claude-sonnet-5')).toBeDefined();
      expect(janelaDoModelo('meu-modelo', 10)).toBe(32_000);
      expect(custoDaMensagem('meu-modelo', uso({ entrada: 1_000_000 }))).toBeCloseTo(1, 10);
    } finally {
      tmp.cleanup();
    }
  });

  it('entrada incompleta ou com texto no lugar de número é ignorada; o padrão fica', () => {
    const tmp = tempDir();
    try {
      usarArquivoDoDono(escreve(tmp.dir, { modelos: { incompleto: { entrada: 1 }, 'claude-opus-5': { entrada: 'caro' } } }));
      expect(precoDoModelo('incompleto')).toBeUndefined();
      expect(precoDoModelo('claude-opus-5')?.entrada).toBe(5);
    } finally {
      tmp.cleanup();
    }
  });

  it('arquivo ausente ou JSON quebrado: vale a tabela padrão', () => {
    const tmp = tempDir();
    try {
      usarArquivoDoDono(join(tmp.dir, 'nao-existe.json'));
      expect(precoDoModelo('claude-opus-5')?.entrada).toBe(5);
      const f = join(tmp.dir, 'quebrado.json');
      writeFileSync(f, '{ isto não é json');
      usarArquivoDoDono(f);
      expect(precoDoModelo('claude-opus-5')?.entrada).toBe(5);
    } finally {
      tmp.cleanup();
    }
  });

  it('relê o arquivo quando ele muda', () => {
    const tmp = tempDir();
    try {
      const f = escreve(tmp.dir, { modelos: { 'meu-modelo': tarifa } });
      usarArquivoDoDono(f);
      const t0 = Date.now();
      expect(tabelaAtual(t0).modelos['meu-modelo'].entrada).toBe(1);
      writeFileSync(f, JSON.stringify({ modelos: { 'meu-modelo': { ...tarifa, entrada: 7 } } }));
      utimesSync(f, new Date(Date.now() + 60_000), new Date(Date.now() + 60_000));
      expect(tabelaAtual(t0 + 100).modelos['meu-modelo'].entrada).toBe(1);
      expect(tabelaAtual(t0 + 10_000).modelos['meu-modelo'].entrada).toBe(7);
    } finally {
      tmp.cleanup();
    }
  });
});
