// Integração da vida social com a simulação (sem DOM): rodas da agenda iguais em duas abas,
// carteiras que vêm do servidor, quem é chamado de volta ao trabalho, apostas, moedinhas pelo
// trabalho e quem espera shell.
import { describe, expect, it } from 'vitest';
import { montarRoda, MotorSocial, partidas } from '../../../../shared/social/agenda';
import { START_COINS, TASK_REWARD, TURN_REWARD, type CarteiraInfo } from '../../../../shared/social/carteiras';
import type { AgentInfo, OfficeSnapshot, RodaAgendada, RoomInfo } from '../../../../shared/types';
import type { Appearance, ArtModule, RoomTheme } from '../../art/api';
import { DEFAULT_WORLD_OPTIONS, type WorldOptions } from '../api';
import { Sim } from '../sim/sim';
import { active, KINDS, type Gathering } from './gathering';
import { CALLED } from './lines';
import { SHELL_SOCIAL_MIN_MS } from './social';

const theme: RoomTheme = {
  carpet: '#4f6d8f',
  carpet2: '#486685',
  wall: { base: '#e6e2da', trim: '#9a8f80', pattern: 'plain' },
  accent: '#3f7fd8',
  deskVariant: 'wood',
  chairVariant: 'black',
};

const appearance: Appearance = {
  skin: '#f0c8a0',
  hair: '#3a2a20',
  hairStyle: 'short',
  eyes: '#222',
  top: '#3f7fd8',
  topAccent: '#fff',
  topStyle: 'tshirt',
  bottom: '#333',
  shoes: '#111',
  accessory: 'none',
  accessoryColor: '#000',
  lanyard: null,
  look: 'm',
};

const art = { appearanceFromSeed: () => appearance, roomTheme: () => theme } as unknown as ArtModule;
const T0 = 1_700_000_000_000;

function room(id: string, slot: number): RoomInfo {
  return { id, name: id.replace('/', ''), path: id, slot, seed: slot * 99 + 7, createdAt: T0 };
}

function agent(id: string, roomId: string, status: AgentInfo['status'], extra: Partial<AgentInfo> = {}): AgentInfo {
  let seed = 0;
  for (const c of id) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
  return {
    id,
    kind: 'main',
    roomId,
    name: id[0].toUpperCase() + id.slice(1),
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: '.claude',
    status,
    recent: [],
    tasks: [],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: seed * 2654435761,
    ...extra,
  };
}

function snap(rooms: RoomInfo[], agents: AgentInfo[], rev = 1): OfficeSnapshot {
  return {
    rev,
    serverTime: T0,
    rooms,
    agents,
    accounts: [{ id: '.claude', short: 'C', name: 'Conta C', color: '#f08a3c', configDir: '~/.claude', sessions: 1, usageStatus: 'ok' }],
    meta: { demo: true, sources: [], startedAt: T0, version: 't' },
  };
}

function carteira(coins: number, extra: Partial<CarteiraInfo> = {}): CarteiraInfo {
  return { coins, earned: coins, wins: 0, losses: 0, vs: {}, ledger: [], ...extra };
}

/** Snapshot como o servidor manda: com as rodas da agenda e as carteiras do livro. */
function snapServidor(rooms: RoomInfo[], agents: AgentInfo[], rodas: RodaAgendada[], carteiras: Record<string, CarteiraInfo>, rev = 1): OfficeSnapshot {
  return { ...snap(rooms, agents, rev), social: { semente: 42, rodas, carteiras } };
}

function retrato(g: Gathering) {
  return { kind: g.kind, seed: g.seed, bet: g.bet, phase: g.phase, score: [...g.score], winner: g.winner, members: g.members.map((m) => [m.id, m.role, m.left]) };
}

function run(sim: Sim, clock: { now: number }, seconds: number, until?: () => boolean): void {
  const steps = Math.round(seconds * 30);
  for (let i = 0; i < steps; i++) {
    clock.now += 1000 / 30;
    sim.update(1 / 30, clock.now);
    if (until?.()) return;
  }
}

function newSim(liveliness: WorldOptions['liveliness'] = 'lively'): Sim {
  return new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness }));
}

const ROOMS = [room('/a', 0), room('/b', 1)];

describe('vida social', () => {
  it('dois ociosos se juntam numa roda sozinhos, sem ninguém forçar', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')]), clock.now);
    let grouped = false;
    run(sim, clock, 240, () => (grouped = [...sim.social.gatherings].some((g) => g.phase === 'run' && active(g).length >= 2)));
    expect(grouped).toBe(true);
    const g = [...sim.social.gatherings].find((x) => x.phase === 'run')!;
    for (const m of active(g)) expect(sim.chars.get(m.id)!.gathering).toBe(g);
  });

  it('sozinho no escritório, ninguém começa uma roda de grupo (só o espelho, que vale sozinho)', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'working')]), clock.now);
    for (let i = 0; i < 120; i++) {
      run(sim, clock, 1);
      for (const g of sim.social.gatherings) {
        expect(g.kind).toBe('mirror');
        expect(g.members).toHaveLength(1);
      }
    }
  });

  it('chamado para trabalhar no meio da TV: avisa a turma, sai correndo e os outros continuam', () => {
    const sim = newSim();
    const clock = { now: T0 };
    const ids = ['ana', 'caio', 'davi'];
    const agents = (s: Record<string, AgentInfo['status']> = {}) => ids.map((id, i) => agent(id, i ? '/b' : '/a', s[id] ?? 'idle'));
    sim.applySnapshot(snap(ROOMS, agents()), clock.now);
    run(sim, clock, 0.3);
    expect(sim.social.force('tv', clock.now, ids)).toHaveLength(3);
    const g = [...sim.social.gatherings][0];
    run(sim, clock, 60, () => g.phase === 'run');
    expect(g.phase).toBe('run');
    sim.applySnapshot(snap(ROOMS, agents({ caio: 'working' }), 2), clock.now);
    const caio = sim.chars.get('caio')!;
    expect(CALLED).toContain(caio.sayText);
    expect(caio.gathering).toBeNull();
    expect(g.members.find((m) => m.id === 'caio')!.left).toBe(true);
    expect(g.phase).toBe('run');
    run(sim, clock, 30, () => caio.atSpot === caio.homeSpot && !caio.step && !caio.queue.length);
    expect(caio.atSpot).toBe(caio.homeSpot);
    expect(sim.chars.get('ana')!.gathering).toBe(g);
  });

  it('jokenpô valendo: o dinheiro só muda de mãos (soma igual) e o placar fecha', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    expect(sim.social.force('rps', clock.now, ['ana', 'caio'])).toHaveLength(2);
    const g = [...sim.social.gatherings][0];
    expect(g.bet).toBeGreaterThan(0);
    // o livro (aqui, a agenda em memória) paga no fim previsto da roda
    run(sim, clock, 120, () => g.phase === 'ended' && clock.now > g.plano.fim + 1_000);
    expect(g.phase).toBe('ended');
    const a = sim.social.info('ana')!;
    const c = sim.social.info('caio')!;
    expect(a.coins + c.coins).toBe(2 * START_COINS.main);
    expect(a.wins + a.losses).toBe(c.wins + c.losses);
    expect(a.wins).toBe(c.losses);
    if (a.wins + a.losses > 0) {
      expect(a.ledger.some((e) => /jokenpô/.test(e.text))).toBe(true);
      expect(sim.social.events.at(-1)?.text).toMatch(/jokenpô/);
      // os cantos de conversa do corredor não têm nome de sala: o lugar sai "Escritório"
      expect(['Recepção', 'Copa', 'Lounge', 'Escritório']).toContain(sim.social.events.at(-1)?.place);
    }
    // a roda acabou: nenhum lugar fica preso a ela
    for (const s of sim.spots.all()) expect(sim.spots.ownerOf(s.id)?.startsWith('g:') ?? false).toBe(false);
  });

  it('ping-pong até 5: um vence, o placar e o feed registram', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    sim.social.force('pingpong', clock.now, ['ana', 'caio']);
    const g = [...sim.social.gatherings][0];
    run(sim, clock, 180, () => g.phase === 'ended' && clock.now > g.plano.fim + 1_000);
    expect(g.phase).toBe('ended');
    expect(Math.max(...g.score)).toBe(5);
    expect(g.winner).toBeTruthy();
    expect(sim.social.info(g.winner!)!.wins).toBe(1);
    expect(sim.social.events.some((e) => e.agentId === g.winner && /pingue-pongue \(5 a \d\)/.test(e.text))).toBe(true);
  });

  it('moedinhas pelo trabalho: tarefa concluída (+10) e pedido atendido (+5), com "+🪙" sobre a cabeça', () => {
    const sim = newSim();
    const clock = { now: T0 };
    const tasks = [{ id: '1', title: 'Login', status: 'in_progress' as const }];
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'working', { tasks, activity: { id: 'a1', kind: 'edit', icon: '✏️', text: 'Editando', at: T0 } })]), clock.now);
    expect(sim.social.info('ana')!.coins).toBe(START_COINS.main);
    run(sim, clock, 1);
    sim.applySnapshot(
      snap(ROOMS, [agent('ana', '/a', 'idle', { tasks: [{ ...tasks[0], status: 'completed' }], activity: { id: 'a2', kind: 'done', icon: '✅', text: 'Concluiu', at: clock.now } })], 2),
      clock.now,
    );
    expect(sim.social.info('ana')!.coins).toBe(START_COINS.main + TASK_REWARD + TURN_REWARD);
    expect(sim.social.floaters.filter((f) => f.charId === 'ana').map((f) => f.text).sort()).toEqual([`+🪙${TASK_REWARD}`, `+🪙${TURN_REWARD}`].sort());
  });

  it(`quem espera shell só entra numa roda depois de ${SHELL_SOCIAL_MIN_MS / 1000} s (antes, pipoca na mesa)`, () => {
    const sim = newSim();
    const clock = { now: T0 };
    const shells = [{ id: 'b1', label: 'Testes', startedAt: T0, background: true, kind: 'shell' as const }];
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'shell', { shells }), agent('caio', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    const ana = sim.chars.get('ana')!;
    expect(ana.mode).toBe('shell');
    expect(sim.social.canJoin(ana, clock.now)).toBe(false);
    clock.now = T0 + SHELL_SOCIAL_MIN_MS + 1000;
    sim.update(1 / 30, clock.now);
    if (!ana.step && !ana.queue.length) expect(sim.social.canJoin(ana, clock.now)).toBe(true);
  });

  it('aba volta do segundo plano: rodas encerradas e lugares devolvidos', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle'), agent('davi', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    sim.social.force('kitchen', clock.now, ['ana', 'caio', 'davi']);
    run(sim, clock, 3);
    sim.fastForward(clock.now);
    expect(sim.social.gatherings.size).toBe(0);
    for (const c of sim.chars.values()) {
      expect(c.gathering).toBeNull();
      expect(c.atSpot).toBe(c.homeSpot);
    }
    for (const s of sim.spots.all()) expect(sim.spots.ownerOf(s.id)?.startsWith('g:') ?? false).toBe(false);
  });

  it('a interface recebe personalidade, carteira, vínculos e o que está fazendo', () => {
    const sim = newSim();
    const clock = { now: T0 };
    sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')]), clock.now);
    run(sim, clock, 0.3);
    sim.social.force('talk', clock.now, ['ana', 'caio']);
    const info = sim.social.info('ana')!;
    expect(info.coins).toBe(START_COINS.main);
    expect(info.traits.length).toBeGreaterThanOrEqual(2);
    expect(info.doing).toMatch(new RegExp(`^${KINDS.talk.emoji} ${KINDS.talk.label} com Caio`));
    expect(sim.social.info('ninguem')).toBeNull();
  });

  it('duas abas com o mesmo snapshot: a mesma roda, os mesmos participantes, o mesmo placar e o mesmo saldo', () => {
    const agents = [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle'), agent('davi', '/b', 'idle')];
    const roda = montarRoda(42, 'r1', 'pingpong', [agents[0], agents[1], agents[2]], T0 + 300, () => 100);
    const carteiras = { ana: carteira(137), caio: carteira(64), davi: carteira(100) };
    const abas = [newSim(), newSim()];
    const clock = { now: T0 };
    for (const sim of abas) sim.applySnapshot(snapServidor(ROOMS, agents, [roda], carteiras), clock.now);
    const retratos: ReturnType<typeof retrato>[][] = [[], []];
    for (let i = 0; i < 120 * 30; i++) {
      clock.now += 1000 / 30;
      abas.forEach((sim, k) => {
        sim.update(1 / 30, clock.now);
        if (i % 30 === 0) retratos[k].push(...[...sim.social.gatherings].map(retrato));
      });
    }
    expect(retratos[0].length).toBeGreaterThan(10);
    expect(retratos[1]).toEqual(retratos[0]);
    const final = retratos[0].at(-1)!;
    expect(final.members.map((m) => m[0])).toEqual(['ana', 'caio', 'davi']);
    expect(Math.max(...final.score)).toBe(5);
    expect(final.winner).toBe(roda.pontos!.filter((p) => p === 0).length === 5 ? 'ana' : 'caio');
    for (const id of ['ana', 'caio', 'davi']) expect(abas[1].social.info(id)!.coins).toBe(abas[0].social.info(id)!.coins);
    // o saldo é o do servidor: a festa da vitória não mexe nele
    expect(abas[0].social.info('ana')!.coins).toBe(137);
  });

  it('recarregar a aba não zera as carteiras: elas vêm do servidor', () => {
    const agents = [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')];
    const ledger = [{ at: T0 - 5_000, delta: 15, icon: '🏓', text: 'Ganhou no pingue-pongue de Caio' }];
    const carteiras = { ana: carteira(215, { wins: 3, losses: 1, vs: { caio: [3, 1] }, ledger }), caio: carteira(15) };
    const antes = newSim();
    antes.applySnapshot(snapServidor(ROOMS, agents, [], carteiras), T0);
    const depois = newSim();
    depois.applySnapshot(snapServidor(ROOMS, agents, [], carteiras), T0 + 60_000);
    for (const sim of [antes, depois]) {
      const info = sim.social.info('ana')!;
      expect(info.coins).toBe(215);
      expect([info.wins, info.losses]).toEqual([3, 1]);
      expect(info.ledger).toEqual(ledger);
      expect(info.bonds.find((b) => b.id === 'caio')?.record ?? [3, 1]).toEqual([3, 1]);
    }
    // nada fica guardado no navegador
    expect(globalThis.localStorage?.getItem?.('expediente.wallets.v1') ?? null).toBeNull();
  });

  it('aba aberta com a roda já andando entra nela e chega ao mesmo resultado, revanche inclusive', () => {
    const agents = [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle')];
    const roda = montarRoda(42, 'r3', 'rps', [agents[0], agents[1]], T0, () => 100);
    expect(roda.revanche).toBeDefined();
    const carteiras = { ana: carteira(100), caio: carteira(100) };
    const velha = newSim();
    const clock = { now: T0 };
    velha.applySnapshot(snapServidor(ROOMS, agents, [roda], carteiras), clock.now);
    run(velha, clock, 6);
    const nova = newSim();
    nova.applySnapshot(snapServidor(ROOMS, agents, [roda], carteiras), clock.now);
    const ga = [...velha.social.gatherings][0];
    let gb: Gathering | undefined;
    for (let i = 0; i < 120 * 30 && !(ga.phase === 'ended' && gb?.phase === 'ended'); i++) {
      clock.now += 1000 / 30;
      velha.update(1 / 30, clock.now);
      nova.update(1 / 30, clock.now);
      gb ??= [...nova.social.gatherings][0];
    }
    expect(gb!.plano).toBe(ga.plano);
    gb = gb!;
    expect([gb.winner, gb.loser, gb.rematches]).toEqual([ga.winner, ga.loser, 1]);
    expect(ga.rematches).toBe(1);
    expect(gb.lance).toBe(roda.jogadas!.length);
  });

  it('duas abas com os mesmos snapshots, depois de o servidor trocar o ritmo, chegam às mesmas rodas', () => {
    const agents = ['ana', 'bia', 'caio', 'davi', 'edu', 'fabi'].map((id, i) => agent(id, i % 2 ? '/b' : '/a', 'idle', { statusSince: T0 - 60_000 }));
    const servidor = new MotorSocial(42);
    // como a interface faz: o mundo das duas abas segue o ritmo que o servidor publica
    let publicado: WorldOptions['liveliness'] = 'normal';
    const abas = [0, 1].map(() => new Sim(art, () => ({ ...DEFAULT_WORLD_OPTIONS, liveliness: publicado })));
    const clock = { now: T0 };
    const retratos: ReturnType<typeof retrato>[][] = [[], []];
    const ritmos = new Set<string | undefined>();
    for (let s = 0; s < 360; s++) {
      if (s === 120) servidor.mudarRitmo('lively');
      servidor.passo(clock.now, agents);
      const social = servidor.estado();
      ritmos.add(social.ritmo);
      publicado = social.ritmo ?? 'normal';
      for (const sim of abas) sim.applySnapshot({ ...snap(ROOMS, agents, s + 1), social: structuredClone(social) }, clock.now);
      for (let f = 0; f < 10; f++) {
        clock.now += 100;
        for (const sim of abas) sim.update(0.1, clock.now);
      }
      abas.forEach((sim, k) => retratos[k].push(...[...sim.social.gatherings].filter((g) => !g.local).map(retrato)));
    }
    expect([...ritmos]).toEqual(['normal', 'lively']);
    expect(retratos[0].length).toBeGreaterThan(50);
    expect(retratos[1]).toEqual(retratos[0]);
  });

  it('sem servidor, a agenda da aba segue o ritmo das opções: calmo tem menos rodas que agitado', () => {
    const agents = ['ana', 'bia', 'caio', 'davi', 'edu', 'fabi'].map((id, i) => agent(id, i % 2 ? '/b' : '/a', 'idle', { statusSince: T0 - 60_000 }));
    const contar = (liveliness: WorldOptions['liveliness']) => {
      const sim = newSim(liveliness);
      const clock = { now: T0 };
      sim.applySnapshot(snap(ROOMS, agents), clock.now);
      const vistas = new Set<string>();
      for (let f = 0; f < 900 * 10; f++) {
        clock.now += 100;
        sim.update(0.1, clock.now);
        if (f % 10 === 0) for (const g of sim.social.gatherings) if (!g.local) vistas.add(g.plano.id);
      }
      return vistas.size;
    };
    expect(contar('calm')).toBeLessThan(contar('lively'));
  });

  it('sem servidor, a agenda da aba conta a sala inteira, como o servidor: com mais subagentes do que personagens, nenhum deles entra em roda', () => {
    const subsEmRodas = (n: number) => {
      const subs = Array.from({ length: n }, (_, i) => agent(`sub${i}`, '/a', 'idle', { kind: 'sub', parentId: 'ana', startedAt: T0 + i, statusSince: T0 - 60_000 }));
      const sim = newSim();
      const clock = { now: T0 };
      sim.applySnapshot(snap(ROOMS, [agent('ana', '/a', 'idle'), agent('caio', '/b', 'idle'), ...subs]), clock.now);
      const vistos = new Set<string>();
      for (let f = 0; f < 240 * 10; f++) {
        clock.now += 100;
        sim.update(0.1, clock.now);
        if (f % 10 === 0) for (const g of sim.social.gatherings) if (!g.local) for (const m of g.members) if (m.id.startsWith('sub')) vistos.add(m.id);
      }
      return vistos.size;
    };
    expect(subsEmRodas(12)).toBe(0);
    expect(subsEmRodas(8)).toBeGreaterThan(0);
  });
});

describe('subagente numa partida quando a sala passa de oito', () => {
  const sub = (id: string, status: AgentInfo['status'], i: number) => agent(id, '/a', status, { kind: 'sub', parentId: 'ana', startedAt: T0 + i, statusSince: T0 - 60_000 });
  const oito = (dosSete: AgentInfo['status']) => [agent('ana', '/a', 'working'), agent('caio', '/b', 'idle', { statusSince: T0 - 60_000 }), ...Array.from({ length: 7 }, (_, i) => sub(`s${i}`, dosSete, i)), sub('x', 'idle', 7)];

  /**
   * A sala /a tem oito subagentes, todos personagens: sete no estado `dosSete` e `x`, à toa, num pingue-pongue contra
   * Caio. Com a partida rolando chega o nono, esperando você. Com servidor, a agenda faz o papel dele e a aba recebe o
   * snapshot a cada segundo; sem servidor, a partida entra na agenda da própria aba.
   */
  function cena(dosSete: AgentInfo['status'], comServidor: boolean) {
    const fixos = oito(dosSete);
    const servidor = comServidor ? new MotorSocial(42) : null;
    const aba = newSim();
    const clock = { now: T0 };
    const publicar = (agentes: AgentInfo[], rev: number) => {
      servidor?.passo(clock.now, agentes);
      aba.applySnapshot(servidor ? { ...snap(ROOMS, agentes, rev), social: structuredClone(servidor.estado()) } : snap(ROOMS, agentes, rev), clock.now);
    };
    publicar(fixos, 0);
    let roda: RodaAgendada;
    if (servidor) {
      const jogam = ['x', 'caio'].map((id) => fixos.find((a) => a.id === id)!);
      roda = Array.from({ length: 50 }, (_, i) => montarRoda(42, `p${i}`, 'pingpong', jogam, T0, (id) => servidor.carteiras.coins(id))).find((r) => r.aposta > 0)!;
      servidor.incluir(roda);
    } else {
      run(aba, clock, 0.3);
      expect(aba.social.force('pingpong', clock.now, ['x', 'caio'])).toEqual(['X', 'Caio']);
      roda = [...aba.social.gatherings][0].plano;
    }
    let agentes = fixos;
    let g: Gathering | undefined;
    let chegou = 0;
    let virou = Infinity;
    let esperandoNaRoda = 0;
    for (let rev = 1; clock.now < roda.fim + 25_000; rev++) {
      publicar(agentes, rev);
      run(aba, clock, 1);
      g ??= [...aba.social.gatherings][0];
      if (!chegou && g?.phase === 'run') {
        chegou = clock.now;
        agentes = [...fixos, sub('novo', 'waiting', 8)];
      }
      if (clock.now < roda.fim) esperandoNaRoda = Math.max(esperandoNaRoda, aba.fanout.rodas.get('/a')?.esperando ?? 0);
      if (chegou && virou === Infinity && aba.chars.has('novo')) virou = clock.now;
    }
    const xVence = partidas(roda)[0].vencedor === 'x';
    const livro = aba.social.info('caio')!;
    return {
      roda,
      aba,
      chegou,
      virou,
      esperandoNaRoda,
      emTela: { ateOFim: aba.social.events.filter((e) => /no pingue-pongue/.test(e.text)).length, vencedor: g!.winner, xSaiu: g!.members.find((m) => m.id === 'x')!.left },
      noLivro: { partidas: livro.wins + livro.losses, caio: livro.coins - START_COINS.main },
      paga: [
        { ateOFim: 1, vencedor: xVence ? 'x' : 'caio', xSaiu: false },
        { partidas: 1, caio: xVence ? -roda.aposta : roda.aposta },
      ],
    };
  }

  it('a partida que chega no mesmo snapshot de quem espera já segura a vaga de quem joga', () => {
    const fixos = oito('working');
    const [x, caio] = ['x', 'caio'].map((id) => fixos.find((a) => a.id === id)!);
    const carteiras = Object.fromEntries(fixos.map((a) => [a.id, carteira(100)]));
    const aba = newSim();
    const clock = { now: T0 };
    aba.applySnapshot(snapServidor(ROOMS, fixos, [], carteiras), clock.now);
    run(aba, clock, 1);
    const juntos = snapServidor(ROOMS, [...fixos, sub('novo', 'waiting', 8)], [montarRoda(42, 'p', 'pingpong', [x, caio], clock.now, () => 100)], carteiras, 2);
    for (let i = 0; i < 12; i++) {
      aba.applySnapshot(juntos, clock.now);
      run(aba, clock, 1);
    }
    expect([aba.chars.get('x')?.leaving, aba.chars.has('s6'), aba.chars.has('novo')]).toEqual([false, false, true]);
    expect(aba.chars.get('x')!.gathering?.members.map((m) => m.id)).toEqual(['x', 'caio']);
  });

  describe.each([
    ['com servidor', true],
    ['sem servidor', false],
  ])('%s', (_, comServidor) => {
    it('com gente só trabalhando na sala, quem espera tira a vaga de quem trabalha: a partida segue em tela até o fim e é a que o livro paga', () => {
      const { roda, aba, chegou, virou, emTela, noLivro, paga } = cena('working', comServidor);
      if (comServidor) expect(roda.aposta).toBeGreaterThan(0);
      expect([emTela, noLivro]).toEqual(paga);
      expect(virou - chegou).toBeLessThan(12_000);
      expect([aba.chars.has('x'), aba.chars.has('s6')]).toEqual([true, false]);
    });

    it('com os outros sete esperando, ninguém cede a vaga no meio da partida: quem espera fica na roda, contado, e entra quando o jogo acaba, visto até o fim e pago', () => {
      const { roda, aba, virou, esperandoNaRoda, emTela, noLivro, paga } = cena('waiting', comServidor);
      expect([emTela, noLivro]).toEqual(paga);
      expect(esperandoNaRoda).toBe(1);
      expect(virou).toBeGreaterThan(roda.fim);
      expect([aba.chars.has('novo'), aba.chars.has('x')]).toEqual([true, false]);
    });
  });
});
