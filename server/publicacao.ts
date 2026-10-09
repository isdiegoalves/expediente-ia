// Confirmação de que o container publica a porta só em 127.0.0.1. Dentro do container o servidor não distingue
// a origem do pedido, então terminal, histórico e permissões só ligam depois que o docker-up conferiu a publicação
// (docker inspect) e gravou esta confirmação no volume de dados.
import { readFileSync } from 'node:fs';
import { hostname as osHostname } from 'node:os';
import { isLoopbackBind } from './config';

export const PUBLICACAO_ARQUIVO = 'publicacao.json';
export const PUBLICACAO_NAO_CONFIRMADA = 'publicação da porta não confirmada';

export interface Publicacao {
  container: string;
  portas: Array<{ ip: string; porta: number }>;
  em: string;
}

/** Portas publicadas de um `docker inspect` (NetworkSettings.Ports); `ip` vazio vira 0.0.0.0, como o Docker faz. */
export function portasPublicadas(inspect: unknown): Array<{ ip: string; porta: number }> {
  const ports = (inspect as { NetworkSettings?: { Ports?: Record<string, Array<{ HostIp?: string; HostPort?: string }> | null> } })?.NetworkSettings?.Ports ?? {};
  return Object.values(ports).flatMap((binds) => (binds ?? []).map((b) => ({ ip: b.HostIp || '0.0.0.0', porta: Number(b.HostPort) })));
}

/** Confirmação a gravar para o container do `docker inspect`, ou o motivo de não haver (qualquer porta fora de 127.0.0.1). */
export function planejarConfirmacao(inspect: unknown, now: Date = new Date()): { publicacao: Publicacao } | { motivo: string } {
  const id = (inspect as { Id?: unknown })?.Id;
  if (typeof id !== 'string' || !id) return { motivo: 'docker inspect sem o id do container' };
  const portas = portasPublicadas(inspect);
  if (!portas.length) return { motivo: 'o container não publica porta nenhuma' };
  const fora = portas.find((p) => p.ip !== '127.0.0.1');
  if (fora) return { motivo: `a porta ${fora.porta} está publicada em ${fora.ip}, não em 127.0.0.1` };
  return { publicacao: { container: id, portas, em: now.toISOString() } };
}

function motivoDe(file: string, host: string): string | undefined {
  let p: Partial<Publicacao>;
  try {
    p = JSON.parse(readFileSync(file, 'utf8')) as Partial<Publicacao>;
  } catch {
    return PUBLICACAO_NAO_CONFIRMADA;
  }
  if (typeof p.container !== 'string' || host.length < 12 || !p.container.startsWith(host)) return PUBLICACAO_NAO_CONFIRMADA;
  if (!Array.isArray(p.portas) || !p.portas.length || !p.portas.every((x) => isLoopbackBind(x?.ip))) return PUBLICACAO_NAO_CONFIRMADA;
  return undefined;
}

export interface TerminalGateOptions {
  /** Falso quando EXPEDIENTE_TERMINAL desligou o recurso. */
  terminal: boolean;
  inDocker: boolean;
  file: string;
  hostname?: string;
  /** Quanto tempo o resultado vale antes de reler o arquivo. */
  ttlMs?: number;
  now?: () => number;
}

export interface TerminalGate {
  on(): boolean;
  offReason(): string | undefined;
}

/** Trava de terminal, histórico e permissões: falha fechada no container até a confirmação aparecer. */
export function createTerminalGate(opts: TerminalGateOptions): TerminalGate {
  const host = opts.hostname ?? osHostname();
  const ttl = opts.ttlMs ?? 2_000;
  const now = opts.now ?? Date.now;
  let at = -Infinity;
  let reason: string | undefined;
  const offReason = (): string | undefined => {
    if (!opts.terminal) return 'EXPEDIENTE_TERMINAL=0';
    if (!opts.inDocker) return undefined;
    if (now() - at >= ttl) {
      reason = motivoDe(opts.file, host);
      at = now();
    }
    return reason;
  };
  return { on: () => offReason() === undefined, offReason };
}
