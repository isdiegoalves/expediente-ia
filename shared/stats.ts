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
  /** true = calculado dos `usage` e da tabela de preços; false = valor da linha `cost-state`. */
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
  if (s.costUSD !== undefined) return { usd: s.costUSD, estimated: false, unpriced: [] };
  const unpriced = s.unpricedModels ?? [];
  if (s.costEstimatedUSD === undefined && !unpriced.length) return undefined;
  return { ...(s.costEstimatedUSD !== undefined ? { usd: s.costEstimatedUSD } : {}), estimated: true, unpriced };
}
