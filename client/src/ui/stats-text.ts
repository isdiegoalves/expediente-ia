// Textos de contexto, compactações e custo da gaveta do agente.
import type { AgentStats } from '../../../shared/types';
import type { ContextView, CostView } from '../../../shared/stats';
import { formatTokens, formatUSD } from './format';

/** "142 k de 1 M (14%)"; sem janela conhecida, só os tokens. */
export function contextText(v: ContextView): string {
  if (v.window === undefined || v.percent === undefined) return `${formatTokens(v.tokens)} tokens`;
  return `${formatTokens(v.tokens)} de ${formatTokens(v.window)} (${v.percent}%)`;
}

/** Valor exato sem marca; valor calculado marcado "estimado"; modelo sem preço nunca vira zero. */
export function costText(v: CostView): string {
  const semPreco = v.unpriced.length ? `sem preço para ${v.unpriced.join(', ')}` : '';
  if (v.usd === undefined) return semPreco;
  const valor = v.estimated ? `${formatUSD(v.usd)} (estimado)` : formatUSD(v.usd);
  return semPreco ? `${valor} · ${semPreco}` : valor;
}

/** "compactou 3× · última: 967,7 k → 23,3 k"; nada quando o transcript não registra compactação. */
export function compactionText(s: AgentStats): string | null {
  if (!s.compactionCount) return null;
  const last = s.compactions?.at(-1);
  const resumo = `compactou ${s.compactionCount}×`;
  return last ? `${resumo} · última: ${formatTokens(last.preTokens)} → ${formatTokens(last.postTokens)}` : resumo;
}

/** Uma linha por compactação guardada: "automática: 967,7 k → 23,3 k". */
export function compactionDetail(s: AgentStats): string {
  return (s.compactions ?? [])
    .map((c) => `${c.trigger === 'manual' ? 'manual' : 'automática'}: ${formatTokens(c.preTokens)} → ${formatTokens(c.postTokens)}`)
    .join('\n');
}
