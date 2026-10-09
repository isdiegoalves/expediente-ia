import type { AgentInfo, ParadoInfo, SourceInfo } from '../../../shared/types';
import { formatDuration } from './format';

/** "Esperando há 10 min: aprovar uma permissão". */
export function textoEspera(a: Pick<AgentInfo, 'statusSince' | 'waitingFor'>, now: number): string {
  const ms = now - a.statusSince;
  const quanto = ms < 5_000 ? 'Esperando agora' : `Esperando há ${formatDuration(ms)}`;
  return a.waitingFor ? `${quanto}: ${a.waitingFor}` : quanto;
}

/** Linhas da caixa "Parado": há quanto tempo, o que está pendente e o último erro da API. */
export function linhasParado(p: ParadoInfo, now: number): string[] {
  const linhas = [`Sem escrever há ${formatDuration(now - p.desde)}, sem fechamento.`];
  if (p.pendente) linhas.push(`Esperando a ferramenta ${p.pendente} responder.`);
  if (p.erro) {
    const vez = p.tentativa !== undefined ? ` (tentativa ${p.tentativa}${p.maxTentativas ? ` de ${p.maxTentativas}` : ''})` : '';
    linhas.push(`Último erro da API: ${p.erro}${vez}`);
  }
  return linhas;
}

export const AVISO_PROCESSO_NAO_CONFIRMADO = 'No Docker o Expediente não confirma se o processo da sessão ainda existe: se ela foi fechada à força, o agente pode continuar aqui.';

/** Aviso do agente principal quando a fonte dele não confere o PID (Docker). */
export function avisoProcesso(a: Pick<AgentInfo, 'kind' | 'account'>, sources: SourceInfo[] | undefined): string | undefined {
  if (a.kind !== 'main') return undefined;
  return sources?.some((s) => s.label === a.account && s.processoConfirmado === false) ? AVISO_PROCESSO_NAO_CONFIRMADO : undefined;
}
