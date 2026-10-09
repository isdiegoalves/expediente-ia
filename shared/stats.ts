// Contexto e custo de um agente como o escritório os mostra (gaveta e resumo do mod usam estas funções, para o número ser o mesmo).
import type { AgentStats } from './types';

export interface ContextView {
  tokens: number;
  /** Janela do modelo; falta quando o modelo não é conhecido. */
  window?: number;
  /** tokens / janela, em %, arredondado. */
  percent?: number;
}

export interface CostView {
  /** Falta quando nenhum modelo da sessão tem preço na tabela. */
  usd?: number;
  /** true = calculado dos `usage` e da tabela de preços; false = valor da linha `cost-state`, só quando ela cobre a sessão toda. */
  estimated: boolean;
  /** Modelos sem preço, que o custo estimado não inclui. */
  unpriced: string[];
}

export function contextView(s: AgentStats): ContextView | undefined {
  if (s.contextTokens === undefined) return undefined;
  const view: ContextView = { tokens: s.contextTokens };
  if (s.contextWindow) {
    view.window = s.contextWindow;
    view.percent = Math.round((s.contextTokens / s.contextWindow) * 100);
  }
  return view;
}

export function costView(s: AgentStats): CostView | undefined {
  const unpriced = s.unpricedModels ?? [];
  if (s.costUSD !== undefined) {
    const estimativa = s.costEstimatedUSD ?? 0;
    const velho = s.costAfterUSD !== undefined;
    const parcial = s.costPartial === true && s.costUSD < estimativa;
    if (!velho && !parcial) return { usd: s.costUSD, estimated: false, unpriced: [] };
    let usd = s.costUSD + (s.costAfterUSD ?? 0);
    if (parcial) usd = Math.max(usd, estimativa);
    return { usd: Math.round(usd * 10_000) / 10_000, estimated: true, unpriced };
  }
  if (s.costEstimatedUSD === undefined && !unpriced.length) return undefined;
  return { ...(s.costEstimatedUSD !== undefined ? { usd: s.costEstimatedUSD } : {}), estimated: true, unpriced };
}
