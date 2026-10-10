import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../../shared/types';
import { itensDeSubs, resumoGrupo, tituloGrupo, type GrupoSubs } from './equipes';

function sub(id: string, over: Partial<AgentInfo> = {}): AgentInfo {
  return { id, kind: 'sub', parentId: 'p', status: 'working', ...over } as AgentInfo;
}
const grupos = (xs: ReturnType<typeof itensDeSubs>) => xs.filter((x): x is GrupoSubs => x.tipo === 'grupo');
const pai = (id: string) => (id === 'p' ? 'Marina' : undefined);

describe('itensDeSubs', () => {
  it('sem time nem rodada: lista plana, sem cabeçalho', () => {
    const itens = itensDeSubs([sub('a'), sub('b')], pai);
    expect(grupos(itens)).toHaveLength(0);
    expect(itens).toHaveLength(2);
  });

  it('agrupa por teamName e cai no pai quando não há time, com concluídos sobre o total', () => {
    const itens = itensDeSubs(
      [sub('a', { teamName: 'gauntlet', status: 'done' }), sub('b', { teamName: 'gauntlet' }), sub('c', { teamName: 'gauntlet' }), sub('d')],
      pai,
    );
    const [g1, g2] = grupos(itens);
    expect(g1).toMatchObject({ time: 'gauntlet', trabalhando: 2, aToa: 0, concluidos: 1, total: 3 });
    expect(g2).toMatchObject({ pai: 'Marina', trabalhando: 1, concluidos: 0, total: 1 });
    expect(g2.time).toBeUndefined();
    expect(itens.map((i) => (i.tipo === 'grupo' ? 'G' : i.agent.id)).join('')).toBe('GabcGd');
  });

  it('rodada entra com a contagem própria; sem prefixo fica de fora', () => {
    const [g] = grupos(
      itensDeSubs(
        [
          sub('a', { teamName: 't', rodada: 2, status: 'done' }),
          sub('b', { teamName: 't', rodada: 2 }),
          sub('c', { teamName: 't', rodada: 1, status: 'done' }),
          sub('d', { teamName: 't' }),
        ],
        pai,
      ),
    );
    expect(g.rodadas).toEqual([
      { n: 1, trabalhando: 0, aToa: 0, concluidos: 1, total: 1 },
      { n: 2, trabalhando: 1, aToa: 0, concluidos: 1, total: 2 },
    ]);
    expect(resumoGrupo(g)).toBe('2 trabalhando · 2 concluídos · rodada 1: 1 de 1 concluídos · rodada 2: 1 de 2 concluídos');
  });

  it('só rodada, sem time, também agrupa pelo pai', () => {
    const [g] = grupos(itensDeSubs([sub('a', { rodada: 3 })], pai));
    expect(tituloGrupo(g)).toBe('Sem time (Marina)');
    expect(resumoGrupo(g)).toBe('1 trabalhando · rodada 3: 0 de 1 concluídos');
  });

  it('título do time', () => {
    const [g] = grupos(itensDeSubs([sub('a', { teamName: 'gauntlet' })], pai));
    expect(tituloGrupo(g)).toBe('Time gauntlet');
    expect(resumoGrupo(g)).toBe('1 trabalhando');
  });
});

describe('contagem que o servidor publica', () => {
  it('só um dos dois subagentes segue no escritório: o grupo mostra a contagem do servidor', () => {
    const equipes = [{ key: 's|time:g', trabalhando: 1, aToa: 0, concluidos: 1, total: 2, paradosPorVoce: 0, rodadas: [{ n: 1, trabalhando: 1, aToa: 0, concluidos: 1, total: 2 }] }];
    const [g] = grupos(itensDeSubs([sub('e2', { teamName: 'g', rodada: 1, sessionId: 's' })], pai, equipes));
    expect(resumoGrupo(g)).toBe('1 trabalhando · 1 concluído · rodada 1: 1 de 2 concluídos');
  });

  it('parado por você entra no resumo', () => {
    const [g] = grupos(itensDeSubs([sub('a', { teamName: 't', sessionId: 's' })], pai, [{ key: 's|time:t', trabalhando: 1, aToa: 0, concluidos: 1, total: 2, paradosPorVoce: 1, rodadas: [] }]));
    expect(resumoGrupo(g)).toBe('1 trabalhando · 1 concluído · 1 parado por você');
  });
});

describe('teammate à toa', () => {
  it('6 à toa e 1 trabalhando: "1 trabalhando · 6 à toa", sem concluídos', () => {
    const subs = [sub('t0', { teamName: 'x' }), ...[1, 2, 3, 4, 5, 6].map((i) => sub(`t${i}`, { teamName: 'x', status: 'idle' }))];
    const [g] = grupos(itensDeSubs(subs, pai));
    expect(g).toMatchObject({ trabalhando: 1, aToa: 6, concluidos: 0, total: 7 });
    expect(resumoGrupo(g)).toBe('1 trabalhando · 6 à toa');
  });

  it('a rodada conta só os concluídos de verdade', () => {
    const [g] = grupos(itensDeSubs([sub('a', { teamName: 'x', rodada: 1, status: 'idle' }), sub('b', { teamName: 'x', rodada: 1, status: 'done' })], pai));
    expect(resumoGrupo(g)).toBe('1 à toa · 1 concluído · rodada 1: 1 de 2 concluídos');
  });
});
