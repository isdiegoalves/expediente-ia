// Roda da equipe no desenho e no clique: quem aparece, como, e o que o clique abre.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, AgentStatus } from '../../../../shared/types';
import type { RoomTheme } from '../../art/api';
import { lugarDaRoda } from '../layout/roda';
import { layoutProjectRoom } from '../layout/room';
import { escolherIndividuais, montarRoda, type RodaDaSala } from '../sim/fanout';
import { caixaDaRoda, figurasDaRoda, MAX_FIGURAS, rodaAbertaApos, rodaNoPonto } from './roda';

const T0 = 1_700_000_000_000;
const theme: RoomTheme = { carpet: '#4f6d8f', carpet2: '#486685', wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' }, accent: '#3f7fd8', deskVariant: 'wood', chairVariant: 'black' };

function sub(id: string, status: AgentStatus, i: number): AgentInfo {
  return { id, kind: 'sub', parentId: 'pai', roomId: '/a', name: id, look: 'f', role: 'Explore', sessionId: 's', account: '.claude', status, recent: [], tasks: [], startedAt: T0 + i, lastEventAt: T0, statusSince: T0, stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: i * 31 };
}

function roda(statuses: AgentStatus[]): RodaDaSala {
  return montarRoda('/a', escolherIndividuais(statuses.map((s, i) => sub(`m${i}`, s, i)), new Set(), new Set(), 0).roda);
}

const layout = layoutProjectRoom({ id: '/a', slot: 4, seed: 12 }, theme);
const lugar = lugarDaRoda(layout);

describe('figuras da roda', () => {
  it('até cinco aparecem; quem espera você levanta a mão, quem concluiu segura a caixa, quem está à toa toma café', () => {
    const r = roda(['working', 'working', 'done', 'waiting', 'idle', 'working', 'working']);
    const f = figurasDaRoda(r, lugar, T0, () => false);
    expect(f).toHaveLength(MAX_FIGURAS);
    expect(f[0].agent.status).toBe('waiting');
    expect(f[0].pose).toBe('raise_hand');
    const so = figurasDaRoda(roda(['done', 'idle']), lugar, T0, () => false);
    expect(so.map((x) => [x.pose, x.held])).toEqual([
      ['drink', 'coffee'],
      ['stand', 'box'],
    ]);
  });

  it('entre os que trabalham, um fala por vez e os outros leem no notebook', () => {
    const r = roda(['working', 'working', 'working']);
    const falas = new Set<string>();
    for (let t = 0; t < 10; t++) {
      const f = figurasDaRoda(r, lugar, T0 + t * 2800, () => false);
      expect(f.filter((x) => x.pose === 'talk')).toHaveLength(1);
      expect(f.filter((x) => x.pose === 'read' && x.held === 'laptop')).toHaveLength(2);
      falas.add(f.find((x) => x.pose === 'talk')!.agent.id);
    }
    expect(falas.size).toBe(3);
  });

  it('quem ainda tem personagem (voltando para a roda) não aparece em dobro', () => {
    const r = roda(['working', 'working']);
    expect(figurasDaRoda(r, lugar, T0, (id) => id === 'm0').map((x) => x.agent.id)).toEqual(['m1']);
  });
});

describe('clique na roda', () => {
  const sala = (id: string) => (id === '/a' ? { present: true, ghost: false, phase: 'ready', layout } : undefined);

  it('acerta a roda pela caixa do tapete e das cabeças, só em sala pronta', () => {
    const r = roda(['working']);
    const c = caixaDaRoda(lugar);
    expect(rodaNoPonto(lugar.x, lugar.y - 10, [r], sala)).toBe('/a');
    expect(rodaNoPonto(c.x - 1, lugar.y, [r], sala)).toBeNull();
    expect(rodaNoPonto(lugar.x, lugar.y, [r], () => ({ present: true, ghost: false, phase: 'building', layout }))).toBeNull();
  });

  it('abre a lista, fecha no segundo clique, um nome da lista a mantém e o resto fecha', () => {
    const membro = (id: string) => id.startsWith('m');
    expect(rodaAbertaApos(null, { type: 'grupo', id: '/a' }, membro)).toBe('/a');
    expect(rodaAbertaApos('/a', { type: 'grupo', id: '/a' }, membro)).toBeNull();
    expect(rodaAbertaApos('/a', { type: 'grupo', id: '/b' }, membro)).toBe('/b');
    expect(rodaAbertaApos('/a', { type: 'agent', id: 'm3' }, membro)).toBe('/a');
    expect(rodaAbertaApos('/a', { type: 'agent', id: 'pai' }, membro)).toBeNull();
    expect(rodaAbertaApos('/a', { type: 'room', id: '/a' }, membro)).toBeNull();
    expect(rodaAbertaApos('/a', null, membro)).toBeNull();
  });
});
