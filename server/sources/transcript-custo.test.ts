import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { costView } from '../../shared/stats';
import { L, tempDir } from '../test/fixtures';
import { FileTail } from './tail';
import { createTranscriptState, mergePrefix, parseLine, scanPrefix, type TranscriptState } from './transcript';

const T0 = Date.parse('2026-10-06T10:00:00Z');

function feed(state: TranscriptState, lines: string[]): void {
  for (const l of lines) parseLine(state, l, { idPrefix: 'acc:1', now: T0 });
}

const uso = (o: Record<string, number>) => ({ input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...o });

describe('contexto, compactações e custo calculado', () => {
  it('contexto = entrada + caches + saída da última mensagem do assistente com uso, com a janela do modelo', () => {
    const s = createTranscriptState();
    feed(s, [
      L.assistant([L.text('a')], { msgId: 'm1', model: 'claude-opus-5', usage: uso({ input_tokens: 5, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 1_000, output_tokens: 400 }) }),
      L.assistant([L.text('b')], { msgId: 'm2', model: 'claude-opus-5', usage: uso({ input_tokens: 7, cache_read_input_tokens: 120_000, cache_creation_input_tokens: 2_000, output_tokens: 600 }) }),
    ]);
    expect(s.stats).toMatchObject({ contextTokens: 7 + 120_000 + 2_000 + 600, contextWindow: 1_000_000 });
  });

  it('linhas da mesma mensagem não derrubam o contexto (saída parcial depois da final)', () => {
    const s = createTranscriptState();
    feed(s, [
      L.assistant([L.thinking()], { msgId: 'm1', model: 'claude-opus-5', usage: uso({ input_tokens: 3, cache_read_input_tokens: 1000, output_tokens: 50 }) }),
      L.assistant([L.text('x')], { msgId: 'm1', model: 'claude-opus-5', usage: uso({ input_tokens: 3, cache_read_input_tokens: 1000, output_tokens: 20 }) }),
    ]);
    expect(s.stats.contextTokens).toBe(1053);
  });

  it('mensagem sintética ou sem entrada não mexe no contexto', () => {
    const s = createTranscriptState();
    feed(s, [
      L.assistant([L.text('a')], { msgId: 'm1', model: 'claude-opus-5', usage: uso({ input_tokens: 10, output_tokens: 5 }) }),
      L.assistant([L.text('erro')], { msgId: 'm2', model: '<synthetic>', usage: uso({}) }),
    ]);
    expect(s.stats.contextTokens).toBe(15);
  });

  it('modelo que não é claude-* e não está na tabela: contexto sem janela', () => {
    const s = createTranscriptState();
    feed(s, [L.assistant([L.text('a')], { msgId: 'm1', model: 'Qwen3.8-27B-4bit', usage: uso({ input_tokens: 10, output_tokens: 5 }) })]);
    expect(s.stats.contextTokens).toBe(15);
    expect(s.stats.contextWindow).toBeUndefined();
  });

  it('compact_boundary: conta e guarda preTokens, postTokens e gatilho de compactMetadata', () => {
    const s = createTranscriptState();
    feed(s, [
      L.system('compact_boundary', { compactMetadata: { trigger: 'auto', preTokens: 967_716, postTokens: 23_292 } }, { at: T0 }),
      L.system('compact_boundary', { compactMetadata: { trigger: 'manual', preTokens: 785_465, postTokens: 23_442 } }, { at: T0 + 1000 }),
      L.system('compact_boundary', { compactMetadata: {} }, { at: T0 + 2000 }),
    ]);
    expect(s.stats.compactionCount).toBe(3);
    expect(s.stats.compactions).toEqual([
      { at: T0, preTokens: 967_716, postTokens: 23_292, trigger: 'auto' },
      { at: T0 + 1000, preTokens: 785_465, postTokens: 23_442, trigger: 'manual' },
    ]);
  });

  it('guarda só as últimas compactações, mas conta todas', () => {
    const s = createTranscriptState();
    feed(s, Array.from({ length: 12 }, (_, i) => L.system('compact_boundary', { compactMetadata: { preTokens: 100 + i, postTokens: 10 } })));
    expect(s.stats.compactionCount).toBe(12);
    expect(s.stats.compactions).toHaveLength(10);
    expect(s.stats.compactions?.[0].preTokens).toBe(102);
    expect(s.stats.compactions?.at(-1)?.preTokens).toBe(111);
  });

  it('custo estimado: cada mensagem entra uma vez, com o uso final, e o cost-state não o apaga', () => {
    const s = createTranscriptState();
    // claude-opus-5: 5 e 25 USD por milhão de tokens (entrada e saída).
    feed(s, [
      L.assistant([L.thinking()], { msgId: 'm1', model: 'claude-opus-5', usage: uso({ input_tokens: 1_000_000, output_tokens: 10 }) }),
      L.assistant([L.text('x')], { msgId: 'm1', model: 'claude-opus-5', usage: uso({ input_tokens: 1_000_000, output_tokens: 40_000 }) }),
      L.assistant([L.text('y')], { msgId: 'm2', model: 'claude-opus-5', usage: uso({ input_tokens: 200_000 }) }),
      L.raw('cost-state', { totalCostUSD: 9 }),
    ]);
    expect(s.stats.costEstimatedUSD).toBeCloseTo(5 + 1 + 1, 4);
    expect(s.stats.costUSD).toBe(9);
    expect(s.stats.unpricedModels).toBeUndefined();
  });

  it('modelo sem preço entra em unpricedModels e não soma zero escondido', () => {
    const s = createTranscriptState();
    feed(s, [L.assistant([L.text('a')], { msgId: 'm1', model: 'Qwen3.8-27B-4bit', usage: uso({ input_tokens: 1_000_000 }) })]);
    expect(s.stats.unpricedModels).toEqual(['Qwen3.8-27B-4bit']);
    expect(s.stats.costEstimatedUSD).toBeUndefined();
    feed(s, [L.assistant([L.text('b')], { msgId: 'm2', model: 'claude-opus-5', usage: uso({ input_tokens: 1_000_000 }) })]);
    expect(s.stats).toMatchObject({ costEstimatedUSD: 5, unpricedModels: ['Qwen3.8-27B-4bit'] });
  });

  it('janela final + prefixo: custo, compactações e contexto do começo do arquivo entram na ordem certa', async () => {
    const tmp = tempDir();
    try {
      const file = join(tmp.dir, 's.jsonl');
      const prefixLines = [
        L.assistant([L.text('a')], { msgId: 'p1', model: 'claude-opus-5', usage: uso({ input_tokens: 1_000_000 }) }),
        L.system('compact_boundary', { compactMetadata: { trigger: 'auto', preTokens: 900_000, postTokens: 20_000 } }, { at: T0 }),
      ];
      const tailLines = [
        L.system('compact_boundary', { compactMetadata: { trigger: 'manual', preTokens: 500_000, postTokens: 30_000 } }, { at: T0 + 5000 }),
        L.assistant([L.text('b')], { msgId: 't1', model: 'claude-opus-5', usage: uso({ input_tokens: 200_000 }) }),
      ];
      const prefixText = prefixLines.map((l) => `${l}\n`).join('');
      writeFileSync(file, prefixText + tailLines.map((l) => `${l}\n`).join(''));
      const tail = new FileTail(file);
      tail.offset = Buffer.byteLength(prefixText);
      const state = createTranscriptState({ trackPrefix: true });
      for (const line of tail.read().lines) parseLine(state, line, { idPrefix: 'a', now: T0 });
      mergePrefix(state, (await scanPrefix(file, Buffer.byteLength(prefixText), new Set(state.firstMsgIds))).state);
      expect(state.stats.costEstimatedUSD).toBeCloseTo(5 + 1, 4);
      expect(state.stats.compactionCount).toBe(2);
      expect(state.stats.compactions?.map((c) => c.preTokens)).toEqual([900_000, 500_000]);
      expect(state.stats.contextTokens).toBe(200_000);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('cost-state exato só quando cobre a sessão inteira', () => {
  const m = (id: string, at: number) => L.assistant([L.text('x')], { msgId: id, at, model: 'claude-opus-5', usage: uso({ input_tokens: 1_000_000 }) });

  it('mensagens depois da última linha cost-state entram no valor, que fica marcado como estimado', () => {
    const s = createTranscriptState();
    feed(s, [m('m1', T0), L.raw('cost-state', { totalCostUSD: 9 }), m('m2', T0 + 1000), m('m3', T0 + 2000)]);
    expect(costView(s.stats)).toEqual({ usd: 19, estimated: true, unpriced: [] });
  });

  it('um cost-state novo zera o que veio depois do anterior', () => {
    const s = createTranscriptState();
    feed(s, [m('m1', T0), L.raw('cost-state', { totalCostUSD: 9 }), m('m2', T0 + 1000), L.raw('cost-state', { totalCostUSD: 14 })]);
    expect(costView(s.stats)).toEqual({ usd: 14, estimated: false, unpriced: [] });
  });

  it('cost-state sem nada depois continua exato', () => {
    const s = createTranscriptState();
    feed(s, [m('m1', T0), L.raw('cost-state', { totalCostUSD: 9 })]);
    expect(costView(s.stats)).toEqual({ usd: 9, estimated: false, unpriced: [] });
  });

  it('mensagem de modelo sem preço depois do cost-state também tira a marca de exato', () => {
    const s = createTranscriptState();
    feed(s, [
      L.raw('cost-state', { totalCostUSD: 9 }),
      L.assistant([L.text('x')], { msgId: 'q1', at: T0, model: 'Qwen3.8-27B-4bit', usage: uso({ input_tokens: 10 }) }),
    ]);
    expect(costView(s.stats)).toMatchObject({ usd: 9, estimated: true, unpriced: ['Qwen3.8-27B-4bit'] });
  });

  it('processo que começou depois da primeira mensagem e valor abaixo da estimativa: mostra a estimativa, marcada', () => {
    const s = createTranscriptState();
    feed(s, [m('m1', T0), m('m2', T0 + 3_600_000), L.raw('cost-state', { totalCostUSD: 3, startTime: T0 + 1_800_000 })]);
    expect(costView(s.stats)).toEqual({ usd: 10, estimated: true, unpriced: [] });
  });

  it('processo que começou antes da primeira mensagem, ou valor que já alcança a estimativa, continua exato', () => {
    const cedo = createTranscriptState();
    feed(cedo, [m('m1', T0), m('m2', T0 + 1000), L.raw('cost-state', { totalCostUSD: 3, startTime: T0 - 5000 })]);
    expect(costView(cedo.stats)).toEqual({ usd: 3, estimated: false, unpriced: [] });
    const alto = createTranscriptState();
    feed(alto, [m('m1', T0), m('m2', T0 + 1000), L.raw('cost-state', { totalCostUSD: 12, startTime: T0 + 500 })]);
    expect(costView(alto.stats)).toEqual({ usd: 12, estimated: false, unpriced: [] });
  });

  it('cost-state no prefixo e mensagens depois dele na janela do fim continuam estimadas', () => {
    const prefix = createTranscriptState();
    feed(prefix, [m('p1', T0), L.raw('cost-state', { totalCostUSD: 9, startTime: T0 - 1 })]);
    const janela = createTranscriptState();
    feed(janela, [m('t1', T0 + 1000)]);
    mergePrefix(janela, prefix);
    expect(costView(janela.stats)).toEqual({ usd: 14, estimated: true, unpriced: [] });
  });
});
