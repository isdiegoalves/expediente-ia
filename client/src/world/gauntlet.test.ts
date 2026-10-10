// Cenário de escala do mundo: o mock de 10 salas com 30 subagentes cada, aplicado à simulação como na página
// (snapshot a cada 250 ms), conferindo o teto de personagens, a roda de cada sala e os balões sem sobreposição.
import { beforeAll, describe, expect, it } from 'vitest';
import { DemoSimulator } from '../../../shared/demo/simulator';
import type { Appearance, ArtModule, RoomTheme } from '../art/api';
import { DEFAULT_WORLD_OPTIONS } from './api';
import { lugarDoBalao, Ocupacao, sobrepoe, type Caixa } from './render/disposicao';
import { OVERVIEW_ZOOM } from './render/overlay';
import { larguraDaPlaca, pecasDaPlaca, PLACA_H } from './render/roda-texto';
import { MAX_INDIVIDUAIS } from './sim/fanout';
import { Sim } from './sim/sim';

const T0 = 1_700_000_000_000;
const theme: RoomTheme = { carpet: '#4f6d8f', carpet2: '#486685', wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' }, accent: '#3f7fd8', deskVariant: 'wood', chairVariant: 'black' };
const art = { appearanceFromSeed: () => ({ look: 'm' }) as unknown as Appearance, roomTheme: () => theme } as unknown as ArtModule;

let sim: Sim;
let maiorPorSala = 0;
let subsConferidos = 0;
let foraDaRoda = 0;
let contagemErrada = 0;
let rodasVistas = 0;

beforeAll(() => {
  const demo = new DemoSimulator({ seed: 7, sessions: 10, projects: 10, subs: 30 }, T0);
  sim = new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: 'calm' }));
  let now = T0;
  for (let t = 0; t < 45 * 4; t++) {
    now += 250;
    demo.tick(now);
    const snap = demo.snapshot(now);
    sim.applySnapshot(snap, now);
    for (let k = 1; k <= 3; k++) {
      sim.update(1 / 12, now + k * 83);
      const porSala = new Map<string, number>();
      for (const ch of sim.chars.values()) if (!ch.gone && ch.info.kind === 'sub') porSala.set(ch.roomId, (porSala.get(ch.roomId) ?? 0) + 1);
      for (const n of porSala.values()) maiorPorSala = Math.max(maiorPorSala, n);
    }
    for (const a of snap.agents) {
      if (a.kind !== 'sub') continue;
      subsConferidos++;
      const r = sim.fanout.rodaDe(a.id);
      if (r ? r.roomId !== a.roomId : !sim.chars.has(a.id) && a.status !== 'done') foraDaRoda++;
    }
    for (const r of sim.fanout.rodas.values()) {
      rodasVistas++;
      if (r.esperando + r.trabalhando + r.aToa + r.concluido !== r.membros.length) contagemErrada++;
    }
  }
}, 60_000);

describe('gauntlet de 10 salas x 30 subagentes', () => {
  it('nenhuma sala passa de oito subagentes animados, em nenhum quadro', () => {
    expect(maiorPorSala).toBe(MAX_INDIVIDUAIS);
  });

  it('quem não é personagem está na roda da própria sala, e a roda soma por estado', () => {
    expect(subsConferidos).toBeGreaterThan(10_000);
    expect(rodasVistas).toBeGreaterThan(1000);
    expect(foraDaRoda).toBe(0);
    expect(contagemErrada).toBe(0);
  });

  it('nenhum balão se sobrepõe a outro, em qualquer zoom, mesmo com todo mundo pedindo balão de alerta', () => {
    const medir = (_f: string, t: string) => t.length * 6.5;
    for (const zoom of [0.7, 1.2, 2, 3]) {
      for (const todosEsperam of [false, true]) {
        const telaW = sim.building.cols * 16 * 16 * zoom;
        const o = new Ocupacao();
        const livre = (x: number, y: number, w: number, h: number) => o.livre(x, y, w, h);
        const postos: Caixa[] = [];
        const por = (l: Caixa | null) => {
          if (!l) return;
          o.ocupar(l.x, l.y, l.w, l.h);
          postos.push(l);
        };
        // placas das rodas antes dos balões, como no overlay
        for (const r of sim.fanout.rodas.values()) {
          const room = sim.rooms.get(r.roomId);
          if (!room?.present) continue;
          const l = sim.fanout.lugar(room);
          const pecas = pecasDaPlaca(r, zoom < OVERVIEW_ZOOM);
          const pedido = { cx: l.x * zoom, w: larguraDaPlaca(pecas, medir), h: PLACA_H, chip: { w: larguraDaPlaca(pecas.slice(0, 1), medir), h: PLACA_H } };
          por(lugarDoBalao({ ...pedido, base: (l.y + 12) * zoom + 6 + PLACA_H, degraus: 0 }, telaW, livre) ?? lugarDoBalao({ ...pedido, base: (l.y - 34) * zoom - 4, degraus: 2 }, telaW, livre));
        }
        const pedidos = [...sim.chars.values()]
          .filter((ch) => !ch.gone && !ch.inside)
          .map((ch) => ({ ch, alerta: todosEsperam || ch.mode === 'wait' }))
          .sort((a, b) => Number(b.alerta) - Number(a.alerta));
        let alertas = 0;
        for (const { ch, alerta } of pedidos) {
          const texto = alerta ? 'Aprovar uma permissão' : ch.info.activity?.text ?? 'Pensando…';
          const l = lugarDoBalao(
            { cx: ch.x * zoom, base: (ch.y - 26) * zoom - 6, w: Math.min(alerta ? 340 : 220, medir('', texto) + 30), h: 20, chip: { w: 26, h: 20 }, degraus: alerta ? 3 : 0 },
            telaW,
            livre,
          );
          if (l && alerta) alertas++;
          por(l);
        }
        let sobrepostos = 0;
        for (let i = 0; i < postos.length; i++) for (let j = i + 1; j < postos.length; j++) if (sobrepoe(postos[i], postos[j])) sobrepostos++;
        expect(sobrepostos).toBe(0);
        if (todosEsperam) expect(alertas).toBeGreaterThan(10);
      }
    }
  });
});
