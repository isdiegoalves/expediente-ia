import { describe, expect, it } from 'vitest';
import { contextView, costView } from './stats';
import type { AgentStats } from './types';

const base: AgentStats = { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 };

describe('contextView', () => {
  it('sem leitura de uso, sem contexto', () => {
    expect(contextView(base)).toBeUndefined();
  });

  it('tokens, janela e percentual arredondado', () => {
    expect(contextView({ ...base, contextTokens: 142_300, contextWindow: 1_000_000 })).toEqual({ tokens: 142_300, window: 1_000_000, percent: 14 });
  });

  it('sem janela conhecida só tem os tokens', () => {
    expect(contextView({ ...base, contextTokens: 5000 })).toEqual({ tokens: 5000 });
  });
});

describe('costView', () => {
  it('cost-state vale como exato, mesmo havendo estimativa', () => {
    expect(costView({ ...base, costUSD: 1.5, costEstimatedUSD: 1.2 })).toEqual({ usd: 1.5, estimated: false, unpriced: [] });
  });

  it('sem cost-state, o calculado vem marcado como estimado', () => {
    expect(costView({ ...base, costEstimatedUSD: 1.2 })).toEqual({ usd: 1.2, estimated: true, unpriced: [] });
  });

  it('modelo sem preço aparece e nunca vira valor zero', () => {
    expect(costView({ ...base, unpricedModels: ['Qwen3.8-27B-4bit'] })).toEqual({ estimated: true, unpriced: ['Qwen3.8-27B-4bit'] });
    expect(costView({ ...base, costEstimatedUSD: 2, unpricedModels: ['x'] })).toEqual({ usd: 2, estimated: true, unpriced: ['x'] });
  });

  it('sem uso nenhum, sem custo', () => {
    expect(costView(base)).toBeUndefined();
  });
});
