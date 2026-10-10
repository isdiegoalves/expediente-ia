// Ritmo do desenho: quadros cheios enquanto algo acontece; 10 por segundo depois de um tempo sem nada novo.
// Puro (o relógio entra por parâmetro) para o teste provar o agendamento sem navegador.
import type { AgentStatus, OfficeSnapshot } from '../../../shared/types';

/** Sem novidade por este tempo, o desenho cai para `QUADRO_CALMO_MS` entre quadros. */
export const CALMO_APOS_MS = 60_000;
/** Espera entre quadros com o escritório calmo: 105 ms rendem até 9,6 quadros por segundo em 60, 120 e 144 Hz (o teste confere). */
export const QUADRO_CALMO_MS = 105;

const OCUPADOS: ReadonlySet<AgentStatus> = new Set(['working', 'waiting']);

/** Alguém trabalhando ou esperando resposta: o desenho fica em quadros cheios. Shell em segundo plano (servidor de desenvolvimento o dia todo) não conta. */
export function haAgenteOcupado(snap: OfficeSnapshot): boolean {
  return snap.agents.some((a) => OCUPADOS.has(a.status));
}

/** O que o desenho mostra do snapshot (agentes e salas); contas, uso e relógios do servidor ficam de fora. */
export function assinaturaDoMundo(snap: OfficeSnapshot): string {
  return JSON.stringify([snap.agents, snap.rooms]);
}

export class Ritmo {
  private ultimoEvento: number;
  private assinatura: string | null = null;
  private ocupado = false;

  constructor(
    agora: number,
    private readonly calmoAposMs = CALMO_APOS_MS,
    private readonly quadroCalmoMs = QUADRO_CALMO_MS,
  ) {
    this.ultimoEvento = agora;
  }

  /** Algo aconteceu (interação, alerta, câmera, mudança no snapshot): quadros cheios a partir de agora. */
  acordar(agora: number): void {
    this.ultimoEvento = agora;
  }

  /** Snapshot novo. Devolve se ele pede quadros cheios: tem agente ocupado ou muda o que se vê. */
  observarSnapshot(snap: OfficeSnapshot, agora: number): boolean {
    this.ocupado = haAgenteOcupado(snap);
    const assinatura = this.ocupado ? null : assinaturaDoMundo(snap);
    const mudou = this.ocupado || assinatura !== this.assinatura;
    this.assinatura = assinatura;
    if (mudou) this.acordar(agora);
    return mudou;
  }

  calmo(agora: number): boolean {
    return !this.ocupado && agora - this.ultimoEvento >= this.calmoAposMs;
  }

  /** Quanto esperar para o próximo quadro; 0 = já. */
  esperaMs(agora: number, ultimoDesenho: number): number {
    if (!this.calmo(agora)) return 0;
    return Math.max(0, this.quadroCalmoMs - (agora - ultimoDesenho));
  }
}
