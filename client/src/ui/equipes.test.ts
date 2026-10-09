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
    expect(g1).toMatchObject({ time: 'gauntlet', concluidos: 1, total: 3 });
    expect(g2).toMatchObject({ pai: 'Marina', concluidos: 0, total: 1 });
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
      { n: 1, concluidos: 1, total: 1 },
      { n: 2, concluidos: 1, total: 2 },
    ]);
    expect(resumoGrupo(g)).toBe('2/4 concluídos · rodada 1: 1/1 · rodada 2: 1/2');
  });

  it('só rodada, sem time, também agrupa pelo pai', () => {
    const [g] = grupos(itensDeSubs([sub('a', { rodada: 3 })], pai));
    expect(tituloGrupo(g)).toBe('Sem time (Marina)');
    expect(resumoGrupo(g)).toBe('0/1 concluídos · rodada 3: 0/1');
  });

  it('título do time', () => {
    const [g] = grupos(itensDeSubs([sub('a', { teamName: 'gauntlet' })], pai));
    expect(tituloGrupo(g)).toBe('Time gauntlet');
    expect(resumoGrupo(g)).toBe('0/1 concluídos');
  });
});

describe('contagem que o servidor publica', () => {
  it('só um dos dois subagentes segue no escritório: o grupo mostra a contagem do servidor', () => {
    const equipes = [{ key: 's|time:g', concluidos: 1, total: 2, paradosPorVoce: 0, rodadas: [{ n: 1, concluidos: 1, total: 2 }] }];
    const [g] = grupos(itensDeSubs([sub('e2', { teamName: 'g', rodada: 1, sessionId: 's' })], pai, equipes));
    expect(resumoGrupo(g)).toBe('1/2 concluídos · rodada 1: 1/2');
  });

  it('parado por você entra no resumo', () => {
    const [g] = grupos(itensDeSubs([sub('a', { teamName: 't', sessionId: 's' })], pai, [{ key: 's|time:t', concluidos: 1, total: 2, paradosPorVoce: 1, rodadas: [] }]));
    expect(resumoGrupo(g)).toBe('1/2 concluídos · 1 parado por você');
  });
});
