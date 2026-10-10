import { describe, expect, it } from 'vitest';
import { DemoSimulator } from './simulator';

describe('DemoSimulator', () => {
  it('no ?mock=1 imita as contas C e D', () => {
    const sim = new DemoSimulator({ seed: 1 }, 1_000);
    expect(sim.snapshot(1_000).accounts.map((a) => [a.id, a.short])).toEqual([
      ['.claude', 'C'],
      ['.claude-conta2', 'D'],
    ]);
  });

  it('com idPrefix usa contas próprias e ids que não colidem com dados reais', () => {
    const sim = new DemoSimulator({ seed: 1, idPrefix: 'demo:', sessions: 5 }, 1_000);
    const snap = sim.snapshot(1_000);
    expect(snap.accounts.map((a) => [a.id, a.short, a.name])).toEqual([
      ['demo:.claude', 'X', 'Demo X'],
      ['demo:.claude-conta2', 'Y', 'Demo Y'],
    ]);
    expect(snap.agents.every((a) => a.id.startsWith('demo:') && a.account.startsWith('demo:'))).toBe(true);
    expect(snap.rooms.every((r) => r.id.startsWith('demo:'))).toBe(true);
  });

  it('ids de atividades não se repetem entre instâncias (religar o demo)', () => {
    const ids = new Set<string>();
    for (const start of [1_000, 2_000]) {
      const sim = new DemoSimulator({ seed: 7, idPrefix: 'demo:', speed: 20 }, start);
      for (let t = start; t < start + 60_000; t += 250) for (const f of sim.tick(t).feed) {
        expect(ids.has(f.id)).toBe(false);
        ids.add(f.id);
      }
    }
    expect(ids.size).toBeGreaterThan(10);
  });

  it('abre com alguém esperando um shell em segundo plano (com job e balão), e o shell termina com ShellDone', () => {
    const start = 5_000;
    const sim = new DemoSimulator({ seed: 3 }, start);
    const waiting = sim.snapshot(start).agents.filter((a) => a.status === 'shell');
    expect(waiting.length).toBeGreaterThanOrEqual(1);
    const a = waiting[0];
    expect(a.shells?.length).toBeGreaterThanOrEqual(1);
    expect(a.shells!.every((j) => j.background && j.kind === 'shell' && j.startedAt < start && j.label)).toBe(true);
    expect(a.activity).toMatchObject({ tool: 'ShellWait' });
    const done: string[] = [];
    for (let t = start; t < start + 200_000; t += 250) {
      for (const f of sim.tick(t).feed) if (f.activity.tool === 'ShellDone') done.push(f.agentId);
    }
    expect(done).toContain(a.id);
  });

  it('com o tempo: shells em segundo plano (status shell), comandos longos em primeiro plano e falhas', () => {
    for (const seed of [1, 2, 3]) {
      const sim = new DemoSimulator({ seed, speed: 10, sessions: 5 }, 0);
      const seen = { shell: 0, foreground: 0, ok: 0, failed: 0, noticeWait: 0 };
      for (let t = 0; t < 3_600_000 / 10; t += 250) {
        const r = sim.tick(t);
        for (const f of r.feed) {
          if (f.activity.tool !== 'ShellDone') continue;
          if (f.activity.error) seen.failed++;
          else seen.ok++;
        }
        seen.noticeWait += r.notices.filter((n) => n.text.includes('está esperando o shell')).length;
        if (!r.changed) continue;
        for (const a of sim.snapshot(t).agents) {
          if (a.status === 'shell') {
            seen.shell++;
            expect(a.shells?.some((j) => j.background)).toBe(true);
          }
          if (a.status === 'working' && a.shells?.some((j) => !j.background)) seen.foreground++;
          if (a.status === 'idle') expect(a.shells).toBeUndefined();
        }
      }
      expect(seen.shell).toBeGreaterThan(0);
      expect(seen.foreground).toBeGreaterThan(0);
      expect(seen.ok).toBeGreaterThan(0);
      expect(seen.noticeWait).toBeGreaterThan(0);
      if (seed === 1) expect(seen.ok + seen.failed).toBeGreaterThan(3);
    }
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('fan-out de três ou mais gera subagentes com time, nome com prefixo de rodada e um parado pelo usuário (semente %i)', (seed) => {
    const vistos = new Map<string, { teamName?: string; agentName?: string; rodada?: number; stoppedByUser?: boolean }>();
    const sim = new DemoSimulator({ seed, idPrefix: `s${seed}:`, sessions: 10, speed: 20 }, 1_000);
    for (let t = 1_000; t < 60_000; t += 500) {
      sim.tick(t);
      for (const a of sim.snapshot(t).agents) if (a.kind === 'sub') vistos.set(a.id, a);
    }
    const comTime = [...vistos.values()].filter((a) => a.teamName);
    expect(comTime.length).toBeGreaterThan(0);
    for (const a of comTime) expect(a.agentName).toMatch(new RegExp(`^r${a.rodada}-`));
    expect(comTime.some((a) => a.stoppedByUser)).toBe(true);
    expect([...vistos.values()].some((a) => !a.teamName)).toBe(true);
  });
  it('projects e subs montam a carga fixa: salas distintas, uma sessão por sala e subagentes repostos', () => {
    const sim = new DemoSimulator({ seed: 5, sessions: 10, projects: 10, subs: 30 }, 0);
    const contar = () => {
      const snap = sim.snapshot();
      const porSala = new Map<string, number>();
      for (const a of snap.agents) if (a.kind === 'sub' && a.status === 'working') porSala.set(a.roomId, (porSala.get(a.roomId) ?? 0) + 1);
      return { rooms: snap.rooms, mains: snap.agents.filter((a) => a.kind === 'main'), porSala };
    };
    sim.tick(0);
    expect(contar().mains).toHaveLength(10);
    for (let t = 1_000; t <= 90_000; t += 1_000) sim.tick(t);
    const { rooms, mains, porSala } = contar();
    expect(new Set(rooms.map((r) => r.name)).size).toBe(10);
    expect(mains).toHaveLength(10);
    expect(mains.every((m) => m.status !== 'offline')).toBe(true);
    expect([...porSala.values()]).toEqual(Array(10).fill(30));
  });

  it('sem projects e subs o padrão não muda: no máximo os 6 projetos fixos', () => {
    const sim = new DemoSimulator({ seed: 5, sessions: 10 }, 0);
    for (let t = 0; t <= 90_000; t += 1_000) sim.tick(t);
    expect(new Set(sim.snapshot().rooms.map((r) => r.name)).size).toBeLessThanOrEqual(6);
  });
});
