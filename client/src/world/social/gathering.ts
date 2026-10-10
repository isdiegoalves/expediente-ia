// Rodas (atividades em grupo dos ociosos) no navegador: participantes, poses e o estado do roteiro.
// As regras puras e a agenda (quem vai, quando, resultado) ficam em shared/social/; o roteiro de
// cada roda (quem fala, comemora, paga) fica em social.ts.
import type { RodaAgendada } from '../../../../shared/types';
import type { Dir, HeldItem, Pose } from '../../art/api';
import type { GatherKind, Gesture, Program } from '../../../../shared/social/regras';

export * from '../../../../shared/social/regras';

export type Role = 'player' | 'watcher' | 'talker';

/** Programa da TV -> seed de drawScreen('show') (contrato da arte: seed % 3). */
export const PROGRAM_SEED: Readonly<Record<Program, number>> = { futebol: 0, novela: 1, desenho: 2 };

export interface Member {
  id: string;
  role: Role;
  /** Spot reservado pela roda (assento, ponto de uso, ponto da torcida) ou null (em pé num tile). */
  spot: string | null;
  /** Em pé sem spot (torcida do jokenpô). */
  tile?: { x: number; y: number; dir: Dir };
  arrived: boolean;
  left: boolean;
  /** Entrou com a roda já formada (ou se formando): ninguém espera por ele para começar. */
  late?: boolean;
  /** Pose de base enquanto participa. */
  pose: Pose;
  held: HeldItem;
  /** Ação curta por cima da pose de base (comemorar, rir, gesto...). */
  actPose: Pose | null;
  actHeld: HeldItem;
  actUntil: number;
  /** O que segura ao voltar para a mesa (o café da copa). */
  carry: 'none' | 'coffee' | 'water';
}

export interface Gathering {
  id: number;
  kind: GatherKind;
  /** A roda como a agenda decidiu: participantes, aposta, resultado e a hora do fim. */
  plano: RodaAgendada;
  /** Montada aqui, fora da agenda (espelho sozinho, depuração): quem está nela pode ir para uma roda agendada. */
  local: boolean;
  /** Próximo ponto (ou jogada do jokenpô) do plano a acontecer. */
  lance: number;
  host: string;
  members: Member[];
  /** gather: indo para os lugares; run: rolando; final: comemoração/despedida; ended: acabou. */
  phase: 'gather' | 'run' | 'final' | 'ended';
  createdAt: number;
  startAt: number;
  /** Fim previsto (atividades sem placar). */
  until: number;
  /** Próxima batida do roteiro. */
  nextAt: number;
  /** Contador de batidas (uso livre por roteiro). */
  step: number;
  seed: number;
  rng: () => number;
  program: Program | null;
  /** Moedinhas em jogo (0 = só pela honra). */
  bet: number;
  /** Placar [jogador 0, jogador 1]. */
  score: [number, number];
  gestures: [Gesture, Gesture] | null;
  ties: number;
  rematches: number;
  winner: string | null;
  loser: string | null;
  /** Spots reservados pela roda (dono `g:<id>`), devolvidos quando ela acaba. */
  pool: string[];
  lastLine: string | null;
  lastSpeaker: string | null;
  /** Falas agendadas (ex.: o "bora!" de quem foi convidado, um pouco depois do convite). */
  pending: { id: string; at: number; text: string }[];
}

export function ownerTag(g: Pick<Gathering, 'id'>): string {
  return `g:${g.id}`;
}

export function players(g: Gathering): Member[] {
  return g.members.filter((m) => m.role === 'player' && !m.left);
}

export function active(g: Gathering): Member[] {
  return g.members.filter((m) => !m.left);
}


/** Ícone de cada gesto acima da cabeça (contrato da arte). */
export const GESTURE_ICON = { rock: 'hand_rock', paper: 'hand_paper', scissors: 'hand_scissors' } as const;
