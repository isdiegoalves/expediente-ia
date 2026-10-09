import { describe, expect, it } from 'vitest';
import type { AgentStats } from '../../../shared/types';
import { compactionDetail, compactionText, contextText, costText } from './stats-text';

const base: AgentStats = { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 };

describe('contextText', () => {
  it('tokens, janela e percentual', () => {
    expect(contextText({ tokens: 142_300, window: 1_000_000, percent: 14 })).toBe('142,3 k de 1 M (14%)');
  });
  it('sem janela, só os tokens', () => {
    expect(contextText({ tokens: 850 })).toBe('850 tokens');
  });
});

describe('costText', () => {
  it('exato: valor sem marca', () => {
    expect(costText({ usd: 12.5, estimated: false, unpriced: [] })).toBe('US$ 12,50');
  });
  it('calculado: marcado como estimado', () => {
    expect(costText({ usd: 12.5, estimated: true, unpriced: [] })).toBe('US$ 12,50 (estimado)');
  });
  it('modelo sem preço: avisa, com ou sem valor', () => {
    expect(costText({ usd: 3, estimated: true, unpriced: ['Qwen3.8-27B-4bit'] })).toBe('US$ 3,00 (estimado) · sem preço para Qwen3.8-27B-4bit');
    expect(costText({ estimated: true, unpriced: ['a', 'b'] })).toBe('sem preço para a, b');
  });
});

describe('compactionText', () => {
  it('nada sem compactação', () => {
    expect(compactionText(base)).toBeNull();
  });
  it('quantidade e a última, com os tokens de antes e depois', () => {
    const s: AgentStats = { ...base, compactionCount: 3, compactions: [{ at: 1, preTokens: 967_716, postTokens: 23_292, trigger: 'auto' }] };
    expect(compactionText(s)).toBe('compactou 3× · última: 967,7 k → 23,3 k');
  });
  it('contagem sem metadados de tokens', () => {
    expect(compactionText({ ...base, compactionCount: 1 })).toBe('compactou 1×');
  });
  it('detalhe: uma linha por compactação guardada', () => {
    const s: AgentStats = {
      ...base,
      compactionCount: 2,
      compactions: [
        { at: 1, preTokens: 900_000, postTokens: 20_000, trigger: 'auto' },
        { at: 2, preTokens: 500_000, postTokens: 30_000, trigger: 'manual' },
      ],
    };
    expect(compactionDetail(s)).toBe('automática: 900 k → 20 k\nmanual: 500 k → 30 k');
  });
});
