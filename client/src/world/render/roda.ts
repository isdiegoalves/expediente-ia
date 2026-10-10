// Roda da equipe no desenho do mundo: até cinco dos subagentes que não viraram personagens, em pé em volta de um
// tapete na cor da sala, conversando. A placa com a contagem e a lista são do overlay (render/roda-texto.ts).
import { shade, withAlpha } from '../../art/core/color';
import type { Dir, HeldItem, Pose } from '../../art/api';
import type { AgentInfo } from '../../../../shared/types';
import { hash32 } from '../../../../shared/hash';
import type { Hit } from '../input';
import { lugarDaRoda, type LugarDaRoda } from '../layout/roda';
import type { AreaLayout } from '../layout/types';
import { estadoNaRoda, type RodaDaSala } from '../sim/fanout';

export const MAX_FIGURAS = 5;

/** Lugares em volta do tapete (px a partir do centro) e para onde cada um olha, por quantos aparecem. */
const FORMACOES: ReadonlyArray<ReadonlyArray<readonly [number, number, Dir]>> = [
  [],
  [[0, 2, 'down']],
  [
    [-8, 1, 'right'],
    [8, 1, 'left'],
  ],
  [
    [-10, -2, 'right'],
    [10, -2, 'left'],
    [0, 8, 'up'],
  ],
  [
    [-7, -5, 'down'],
    [8, -5, 'down'],
    [-15, 3, 'right'],
    [15, 3, 'left'],
  ],
  [
    [-7, -6, 'down'],
    [8, -6, 'down'],
    [-16, 2, 'right'],
    [16, 2, 'left'],
    [0, 9, 'up'],
  ],
];

/** Fala da vez: troca a cada tanto, e cada sala tem o seu ritmo. */
const FALA_MS = 2800;

export interface Figura {
  agent: AgentInfo;
  x: number;
  y: number;
  dir: Dir;
  pose: Pose;
  held: HeldItem;
  /** Relógio da animação (cada um no seu passo). */
  animT: number;
}

/**
 * Quem aparece na roda e como: quem espera você levanta a mão, quem trabalha lê no notebook enquanto um fala, quem
 * está à toa toma café e quem concluiu segura a caixa. Quem ainda tem personagem (voltando para a roda) não aparece
 * em dobro.
 */
export function figurasDaRoda(r: RodaDaSala, l: LugarDaRoda, now: number, temPersonagem: (id: string) => boolean): Figura[] {
  const vez: AgentInfo[] = [];
  for (const m of r.membros) {
    if (vez.length >= MAX_FIGURAS) break;
    if (!temPersonagem(m.id)) vez.push(m);
  }
  const forma = FORMACOES[vez.length];
  const ritmo = hash32(r.roomId) % 997;
  const trabalhando = vez.filter((m) => estadoNaRoda(m.status) === 'trabalhando');
  const fala = trabalhando.length ? trabalhando[Math.floor(now / FALA_MS + ritmo) % trabalhando.length] : null;
  return vez.map((agent, i) => {
    const [dx, dy, dir] = forma[i];
    const estado = estadoNaRoda(agent.status);
    const [pose, held]: [Pose, HeldItem] =
      estado === 'esperando'
        ? ['raise_hand', 'none']
        : estado === 'concluido'
          ? ['stand', 'box']
          : estado === 'aToa'
            ? ['drink', 'coffee']
            : agent === fala
              ? ['talk', 'none']
              : ['read', 'laptop'];
    return { agent, x: l.x + dx, y: l.y + dy, dir, pose, held, animT: now + (agent.seed % 1000) };
  });
}

/** Caixa (px de mundo) que o clique na roda pega: o tapete e as cabeças. */
export function caixaDaRoda(l: LugarDaRoda): { x: number; y: number; w: number; h: number } {
  return { x: l.x - 24, y: l.y - 36, w: 48, h: 48 };
}

/** Sala cuja roda está no ponto (px de mundo), só nas salas prontas. */
export function rodaNoPonto(
  x: number,
  y: number,
  rodas: Iterable<RodaDaSala>,
  sala: (id: string) => { present: boolean; ghost: boolean; phase: string; layout: AreaLayout } | undefined,
): string | null {
  for (const r of rodas) {
    const room = sala(r.roomId);
    if (!room?.present || room.ghost || room.phase !== 'ready') continue;
    const c = caixaDaRoda(lugarDaRoda(room.layout));
    if (x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h) return r.roomId;
  }
  return null;
}

/** Roda com a lista aberta depois de um clique: a roda abre e fecha; um nome da lista a mantém; o resto fecha. */
export function rodaAbertaApos(aberta: string | null, hit: Hit, membro: (id: string) => boolean): string | null {
  if (hit?.type === 'grupo') return aberta === hit.id ? null : hit.id;
  if (hit?.type === 'agent' && membro(hit.id)) return aberta;
  return null;
}

const TAPETE_W = 50;
const TAPETE_H = 20;
const tapetes = new Map<string, HTMLCanvasElement>();

/** Tapete oval da equipe na cor da sala, em pixels (como o resto do piso). */
export function tapeteDaRoda(cor: string): HTMLCanvasElement {
  const hit = tapetes.get(cor);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = TAPETE_W;
  c.height = TAPETE_H;
  const ctx = c.getContext('2d')!;
  const a = TAPETE_W / 2;
  const b = TAPETE_H / 2;
  const miolo = withAlpha(cor, 0.6);
  const borda = withAlpha(shade(cor, -0.18), 0.85);
  const brilho = withAlpha(shade(cor, 0.14), 0.6);
  for (let y = 0; y < TAPETE_H; y++) {
    for (let x = 0; x < TAPETE_W; x++) {
      const d = ((x + 0.5 - a) / a) ** 2 + ((y + 0.5 - b) / b) ** 2;
      if (d > 1) continue;
      ctx.fillStyle = d > 0.72 ? borda : d < 0.3 && (x + y) % 2 === 0 ? brilho : miolo;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  tapetes.set(cor, c);
  return c;
}
