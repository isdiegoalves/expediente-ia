import { describe, expect, it } from 'vitest';
import type { AgentInfo, OfficeSnapshot, RoomInfo } from '../../../shared/types';
import { assinaturaDoMundo, CALMO_APOS_MS, haAgenteOcupado, QUADRO_CALMO_MS, Ritmo } from './ritmo';

const VSYNC_MS = 1000 / 60;

function agente(id: string, status: AgentInfo['status'], extra: Partial<AgentInfo> = {}): AgentInfo {
  return { id, kind: 'main', roomId: 'sala', status, statusSince: 0, ...extra } as AgentInfo;
}

function snapshot(agents: AgentInfo[], rev = 1, rooms: RoomInfo[] = []): OfficeSnapshot {
  return { rev, serverTime: rev * 1000, rooms, agents, accounts: [], meta: { demo: false, sources: [], startedAt: 0, version: 't' } } as OfficeSnapshot;
}

/**
 * Repete o que o laço do mundo faz: desenha, pergunta ao ritmo quanto esperar e desenha no primeiro
 * vsync depois da espera ou do evento que acorda (o que vier antes). Devolve os instantes dos quadros.
 */
function quadros(ritmo: Ritmo, ate: number, eventos: Array<{ em: number; fazer: () => void }> = []): number[] {
  const marcas: number[] = [];
  const pendentes = [...eventos].sort((x, y) => x.em - y.em);
  let t = 0;
  while (t <= ate) {
    marcas.push(t);
    let proximo = t + ritmo.esperaMs(t, t);
    const ev = pendentes[0];
    if (ev && ev.em <= proximo) {
      pendentes.shift();
      ev.fazer();
      proximo = Math.max(ev.em, t);
    }
    t = Math.max(Math.ceil(proximo / VSYNC_MS) * VSYNC_MS, t + VSYNC_MS);
  }
  return marcas;
}

const porSegundo = (marcas: number[], de: number, ate: number) => marcas.filter((m) => m >= de && m < ate).length / ((ate - de) / 1000);

describe('ritmo do desenho', () => {
  it('escritório ocioso por 5 minutos: no máximo 10 quadros por segundo depois da janela', () => {
    const ritmo = new Ritmo(0);
    const marcas = quadros(ritmo, 5 * 60_000);
    expect(porSegundo(marcas, 0, 10_000)).toBeGreaterThan(50);
    expect(porSegundo(marcas, CALMO_APOS_MS + 1_000, 5 * 60_000)).toBeLessThanOrEqual(10);
    expect(porSegundo(marcas, CALMO_APOS_MS + 1_000, 5 * 60_000)).toBeGreaterThan(8);
  });

  it('um evento com o desenho calmo volta aos quadros cheios no próximo vsync, bem dentro de 1 segundo', () => {
    const ritmo = new Ritmo(0);
    const evento = 3 * 60_000 + 37;
    const marcas = quadros(ritmo, evento + 3_000, [{ em: evento, fazer: () => ritmo.acordar(evento) }]);
    const depois = marcas.filter((m) => m >= evento);
    expect(depois[0] - evento).toBeLessThanOrEqual(VSYNC_MS + 1);
    expect(porSegundo(marcas, evento, evento + 1_000)).toBeGreaterThanOrEqual(55);
    expect(porSegundo(marcas, evento + 1_000, evento + 2_000)).toBeGreaterThanOrEqual(55);
  });

  it('sem novidade de novo, o desenho volta a 10 por segundo depois da janela', () => {
    const ritmo = new Ritmo(0);
    const evento = 2 * 60_000;
    const marcas = quadros(ritmo, evento + CALMO_APOS_MS + 20_000, [{ em: evento, fazer: () => ritmo.acordar(evento) }]);
    expect(porSegundo(marcas, evento + CALMO_APOS_MS - 5_000, evento + CALMO_APOS_MS - 1_000)).toBeGreaterThan(50);
    expect(porSegundo(marcas, evento + CALMO_APOS_MS + 2_000, evento + CALMO_APOS_MS + 20_000)).toBeLessThanOrEqual(10);
  });

  it('o intervalo calmo respeita o quadro por 100 ms contando o que o quadro já gastou', () => {
    const ritmo = new Ritmo(0);
    const calmo = CALMO_APOS_MS + 1;
    expect(ritmo.esperaMs(calmo, calmo)).toBe(QUADRO_CALMO_MS);
    expect(ritmo.esperaMs(calmo + 30, calmo)).toBe(QUADRO_CALMO_MS - 30);
    expect(ritmo.esperaMs(calmo + 250, calmo)).toBe(0);
    expect(ritmo.esperaMs(CALMO_APOS_MS - 1, 0)).toBe(0);
  });
});

describe('snapshots e o ritmo', () => {
  it('agente trabalhando, esperando ou com shell mantém os quadros cheios a cada snapshot', () => {
    for (const status of ['working', 'waiting', 'shell'] as const) {
      const ritmo = new Ritmo(0);
      let t = 0;
      for (; t < 10 * 60_000; t += 250) {
        expect(ritmo.observarSnapshot(snapshot([agente('a', status), agente('b', 'idle')], t), t)).toBe(true);
        expect(ritmo.calmo(t)).toBe(false);
      }
    }
  });

  it('agente ocupado mantém os quadros cheios mesmo sem snapshot novo por muito tempo', () => {
    const ritmo = new Ritmo(0);
    ritmo.observarSnapshot(snapshot([agente('a', 'working'), agente('b', 'idle')]), 0);
    expect(ritmo.calmo(10 * 60_000)).toBe(false);
    expect(ritmo.esperaMs(10 * 60_000, 10 * 60_000 - 5)).toBe(0);
    ritmo.observarSnapshot(snapshot([agente('a', 'idle'), agente('b', 'idle')]), 10 * 60_000);
    expect(ritmo.calmo(10 * 60_000 + CALMO_APOS_MS - 1)).toBe(false);
    expect(ritmo.calmo(10 * 60_000 + CALMO_APOS_MS)).toBe(true);
  });

  it('snapshot igual ao anterior (só rev e relógio mudam) não acorda', () => {
    const ritmo = new Ritmo(0);
    const agentes = [agente('a', 'idle'), agente('b', 'idle')];
    expect(ritmo.observarSnapshot(snapshot(agentes, 1), 0)).toBe(true);
    expect(ritmo.observarSnapshot(snapshot(agentes, 2), 70_000)).toBe(false);
    expect(ritmo.calmo(70_000)).toBe(true);
  });

  it('o alerta novo (agente passa a esperar) acorda na hora, mesmo com tudo calmo', () => {
    const ritmo = new Ritmo(0);
    const ociosos = [agente('a', 'idle'), agente('b', 'idle')];
    ritmo.observarSnapshot(snapshot(ociosos, 1), 0);
    const agora = 4 * 60_000;
    expect(ritmo.calmo(agora)).toBe(true);
    expect(ritmo.observarSnapshot(snapshot([agente('a', 'waiting', { statusSince: agora }), ociosos[1]], 2), agora)).toBe(true);
    expect(ritmo.esperaMs(agora, agora)).toBe(0);
  });

  it('mudança que o desenho mostra acorda: agente novo, sala nova, atividade nova ou efeito de sala', () => {
    const ritmo = new Ritmo(0);
    const base = [agente('a', 'idle')];
    ritmo.observarSnapshot(snapshot(base), 0);
    expect(ritmo.observarSnapshot(snapshot([...base, agente('c', 'idle')]), 70_000)).toBe(true);
    expect(ritmo.observarSnapshot(snapshot([agente('a', 'idle', { activity: { id: 'x', kind: 'done', icon: '', text: '', at: 1 } }), agente('c', 'idle')]), 140_000)).toBe(true);
    const sala = { id: 'sala', name: 'Sala', path: '/s', slot: 0, seed: 1, createdAt: 0 } as RoomInfo;
    expect(ritmo.observarSnapshot(snapshot([agente('a', 'idle'), agente('c', 'idle')], 5, [sala]), 210_000)).toBe(true);
    expect(ritmo.observarSnapshot(snapshot([agente('a', 'idle'), agente('c', 'idle')], 6, [{ ...sala, effect: { kind: 'party', text: 'PR', at: 1 } as RoomInfo['effect'] }]), 280_000)).toBe(true);
  });

  it('assinatura ignora contas, rev e serverTime', () => {
    const a = snapshot([agente('a', 'idle')], 1);
    const b = { ...snapshot([agente('a', 'idle')], 9), accounts: [{ id: 'x' }] } as unknown as OfficeSnapshot;
    expect(assinaturaDoMundo(a)).toBe(assinaturaDoMundo(b));
    expect(haAgenteOcupado(snapshot([agente('a', 'idle'), agente('b', 'done')]))).toBe(false);
  });
});
