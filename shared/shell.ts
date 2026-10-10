// Quem está esperando um shell terminar: regras PURAS, usadas pela animação do escritório e pela
// agenda das rodas (quem espera um comando longo também pode ir para uma roda).
import type { AgentStatus, ShellJob } from './types';

/**
 * Comando em PRIMEIRO plano: só vira "espera" depois disto. Comandos rápidos (ls, git status...)
 * não tiram o personagem da digitação.
 */
export const FOREGROUND_WAIT_MS = 10_000;

function counts(j: ShellJob, foregroundOnly: boolean): boolean {
  return !foregroundOnly || j.background === false;
}

/** O shell mais antigo considerado (sem alocar). `foregroundOnly`: só os de primeiro plano. */
export function oldestShell(shells: readonly ShellJob[] | undefined, foregroundOnly: boolean): ShellJob | null {
  if (!shells) return null;
  let best: ShellJob | null = null;
  for (const j of shells) {
    if (!counts(j, foregroundOnly) || !Number.isFinite(j.startedAt)) continue;
    if (!best || j.startedAt < best.startedAt) best = j;
  }
  return best;
}

/** Quantos shells o agente espera (mesmo critério de `oldestShell`). */
export function countShells(shells: readonly ShellJob[] | undefined, foregroundOnly: boolean): number {
  if (!shells) return 0;
  let n = 0;
  for (const j of shells) if (counts(j, foregroundOnly)) n++;
  return n;
}

/**
 * Esperando um comando em primeiro plano há mais de FOREGROUND_WAIT_MS? (status 'working' com um
 * Bash longo ainda sem resultado: o agente está parado olhando o comando rodar.)
 */
export function foregroundWaiting(shells: readonly ShellJob[] | undefined, now: number): boolean {
  const j = oldestShell(shells, true);
  return !!j && now - j.startedAt > FOREGROUND_WAIT_MS;
}

/**
 * Início (epoch ms) da espera de um agente no modo 'shell': o shell mais antigo (em primeiro plano,
 * quando o status é 'working'); sem nenhum listado, o momento em que o status mudou.
 */
export function shellWaitSince(a: { status: AgentStatus; shells?: ShellJob[]; statusSince: number }): number {
  const j = oldestShell(a.shells, a.status !== 'shell');
  return j ? j.startedAt : a.statusSince;
}
