// Regra do fan-out: quem é personagem, quem fica na roda e como a roda conta cada estado.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, AgentStatus } from '../../../../shared/types';
import { escolherIndividuais, Fanout, MAX_INDIVIDUAIS, type PersonagemEmCena } from './fanout';

const T0 = 1_700_000_000_000;

function sub(id: string, status: AgentStatus = 'working', startedAt = T0, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    kind: 'sub',
    parentId: 'pai',
    roomId: '/a',
    name: id,
    look: 'f',
    role: 'Explore',
    sessionId: 's1',
    account: '.claude',
    status,
    recent: [],
    tasks: [],
    startedAt,
    lastEventAt: startedAt,
    statusSince: startedAt,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: id.length * 7919,
    ...extra,
  };
}

/** n subagentes trabalhando, chegando um por segundo: s0 é o mais antigo. */
const fanOut = (n: number): AgentInfo[] => Array.from({ length: n }, (_, i) => sub(`s${i}`, 'working', T0 + i * 1000));

const ids = (s: Iterable<string>) => [...s].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));

describe('quem é personagem numa sala', () => {
  it('trinta subagentes: oito personagens e os demais na roda, contados por estado', () => {
    const subs = fanOut(30);
    subs[29] = sub('s29', 'waiting', T0 + 29_000);
    subs[28] = sub('s28', 'done', T0 + 28_000);
    const e = escolherIndividuais(subs, new Set(), new Set());
    expect(e.individuais.size).toBe(MAX_INDIVIDUAIS);
    // quem espera você entra primeiro; o resto por ordem de chegada
    expect(ids(e.individuais)).toEqual(['s0', 's1', 's2', 's3', 's4', 's5', 's6', 's29']);
    expect(e.roda).toHaveLength(22);
    expect(e.roda.filter((s) => s.status === 'working')).toHaveLength(21);
    expect(e.roda.filter((s) => s.status === 'done').map((s) => s.id)).toEqual(['s28']);
    expect(e.roda.at(-1)?.id).toBe('s28');
  });

  it('quem já é personagem continua, mesmo chegando gente mais antiga (sem troca a cada snapshot)', () => {
    const subs = fanOut(30);
    const antes = escolherIndividuais(subs, new Set(), new Set()).individuais;
    const veteranos = [sub('v1', 'working', T0 - 60_000), sub('v2', 'working', T0 - 50_000)];
    const depois = escolherIndividuais([...veteranos, ...subs], antes, new Set(antes)).individuais;
    expect(ids(depois)).toEqual(ids(antes));
  });

  it('a vaga de quem concluiu só abre quando ele sai de cena, e vai para quem espera antes de quem trabalha', () => {
    const subs = fanOut(30);
    const antes = escolherIndividuais(subs, new Set(), new Set()).individuais;
    subs[3] = sub('s3', 'done', T0 + 3000);
    subs[20] = sub('s20', 'waiting', T0 + 20_000);
    // ainda entregando: segura a vaga, ninguém entra
    const entregando = escolherIndividuais(subs, antes, new Set(antes));
    expect(entregando.individuais.has('s3')).toBe(true);
    expect(entregando.individuais.has('s20')).toBe(false);
    expect(entregando.roda.find((s) => s.id === 's20')?.status).toBe('waiting');
    // saiu de cena: entra na roda como concluído e a vaga vai para quem espera (s8, mais antigo, fica)
    const emCena = new Set([...antes].filter((id) => id !== 's3'));
    const saiu = escolherIndividuais(subs, entregando.individuais, emCena);
    expect(saiu.individuais.has('s20')).toBe(true);
    expect(saiu.individuais.has('s8')).toBe(false);
    expect(saiu.individuais.has('s3')).toBe(false);
    expect(saiu.roda.find((s) => s.id === 's3')?.status).toBe('done');
  });

  it('quem espera sem vaga tira a de quem só trabalha (o mais novo); até ele sair de cena, a espera fica na contagem', () => {
    const subs = fanOut(30);
    const antes = escolherIndividuais(subs, new Set(), new Set()).individuais;
    subs[15] = sub('s15', 'waiting', T0 + 15_000);
    const troca = escolherIndividuais(subs, antes, new Set(antes));
    expect(troca.individuais.has('s7')).toBe(false);
    expect(troca.roda.map((s) => s.id)).toContain('s7');
    // s7 ainda anda até a roda: a vaga não abriu, s15 espera dentro dela, contado
    expect(troca.individuais.has('s15')).toBe(false);
    expect(troca.roda[0].id).toBe('s15');
    const chegou = escolherIndividuais(subs, troca.individuais, new Set([...antes].filter((id) => id !== 's7')));
    expect(chegou.individuais.has('s15')).toBe(true);
    expect(chegou.individuais.has('s7')).toBe(false);
    expect(chegou.individuais.size).toBe(MAX_INDIVIDUAIS);
  });

  it('quem espera tira primeiro a vaga de quem está à toa', () => {
    const subs = fanOut(12);
    const antes = escolherIndividuais(subs, new Set(), new Set()).individuais;
    subs[2] = sub('s2', 'idle', T0 + 2000);
    subs[10] = sub('s10', 'waiting', T0 + 10_000);
    const e = escolherIndividuais(subs, antes, new Set());
    expect(e.individuais.has('s10')).toBe(true);
    expect(e.individuais.has('s2')).toBe(false);
    expect(e.individuais.has('s7')).toBe(true);
  });

  it('mais gente esperando do que vagas: oito personagens esperando e o resto na roda, contado, ninguém some', () => {
    const subs = Array.from({ length: 12 }, (_, i) => sub(`s${i}`, 'waiting', T0 + i * 1000));
    const e = escolherIndividuais(subs, new Set(), new Set());
    expect(e.individuais.size).toBe(MAX_INDIVIDUAIS);
    expect(e.roda).toHaveLength(4);
    expect(e.roda.every((s) => s.status === 'waiting')).toBe(true);
    const outra = escolherIndividuais(subs, e.individuais, new Set(e.individuais));
    expect(ids(outra.individuais)).toEqual(ids(e.individuais));
  });

  it('até oito subagentes: todos personagens e nenhuma roda', () => {
    const e = escolherIndividuais(fanOut(8), new Set(), new Set());
    expect(e.individuais.size).toBe(8);
    expect(e.roda).toHaveLength(0);
  });
});

describe('fan-out entre snapshots', () => {
  const principal: AgentInfo = { ...sub('pai'), kind: 'main', parentId: undefined };
  const emCena = (f: Fanout, filtrados: AgentInfo[], fora: string[] = []): PersonagemEmCena[] =>
    filtrados.filter((a) => !fora.includes(a.id)).map((a) => ({ id: a.id, roomId: a.roomId, gone: false, info: { kind: a.kind } }));

  it('o principal sempre passa; a roda da sala conta por estado e lembra o time', () => {
    const f = new Fanout();
    const subs = fanOut(12).map((s, i) => ({ ...s, teamName: 'gauntlet', status: (i === 11 ? 'idle' : 'working') as AgentStatus }));
    const out = f.filtrar([principal, ...subs], []);
    expect(out.map((a) => a.id)).toEqual(['pai', 's0', 's1', 's2', 's3', 's4', 's5', 's6', 's7']);
    const r = f.rodas.get('/a')!;
    expect(r.membros.map((m) => m.id)).toEqual(['s8', 's9', 's10', 's11']);
    expect({ esperando: r.esperando, trabalhando: r.trabalhando, aToa: r.aToa, concluido: r.concluido }).toEqual({ esperando: 0, trabalhando: 3, aToa: 1, concluido: 0 });
    expect(r.time).toBe('gauntlet');
    expect(f.membro('s9')).toBe(true);
    expect(f.rodaDe('s9')).toBe(r);
  });

  it('quem sai da roda para virar personagem sai de lá; quem volta para a roda vira membro', () => {
    const f = new Fanout();
    const subs = fanOut(12);
    const primeira = f.filtrar(subs, []);
    subs[9] = sub('s9', 'waiting', T0 + 9000);
    const segunda = f.filtrar(subs, emCena(f, primeira));
    expect(segunda.some((a) => a.id === 's7')).toBe(false);
    expect(f.membro('s7')).toBe(true);
    // s7 chegou à roda (o personagem sumiu): s9 sai da roda com a mão levantada
    const terceira = f.filtrar(subs, emCena(f, primeira, ['s7']));
    expect(terceira.some((a) => a.id === 's9')).toBe(true);
    expect(f.saiDaRoda('s9')).toBe(true);
    expect(f.saiDaRoda('s0')).toBe(false);
  });

  it('sumiu do snapshot por um instante com o personagem em cena: volta como ele mesmo', () => {
    const f = new Fanout();
    const subs = fanOut(12);
    const primeira = f.filtrar(subs, []);
    const personagens = emCena(f, primeira);
    f.filtrar(subs.filter((s) => s.id !== 's2'), personagens);
    const volta = f.filtrar(subs, personagens);
    expect(volta.some((a) => a.id === 's2')).toBe(true);
    expect(f.membro('s2')).toBe(false);
  });
});
