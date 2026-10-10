// Textos da roda: a placa com a contagem por estado e a lista que o clique abre.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, AgentStatus } from '../../../../shared/types';
import { escolherIndividuais, montarRoda, type RodaDaSala } from '../sim/fanout';
import { linhasDaLista, pecasDaPlaca, tituloDaRoda } from './roda-texto';

const T0 = 1_700_000_000_000;

function sub(id: string, status: AgentStatus, i: number, extra: Partial<AgentInfo> = {}): AgentInfo {
  return { id, kind: 'sub', parentId: 'pai', roomId: '/a', name: id, look: 'f', role: 'Explore', sessionId: 's', account: '.claude', status, recent: [], tasks: [], startedAt: T0 + i, lastEventAt: T0, statusSince: T0, stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: i, ...extra };
}

function roda(membros: AgentInfo[]): RodaDaSala {
  return montarRoda('/a', escolherIndividuais(membros, new Set(), new Set(), 0).roda);
}

describe('placa da roda', () => {
  it('o total e cada estado presente, por extenso de perto e só os números de longe', () => {
    const r = roda([sub('a', 'waiting', 1), sub('b', 'working', 2), sub('c', 'working', 3), sub('d', 'done', 4), sub('e', 'idle', 5)]);
    expect(pecasDaPlaca(r, false).map((p) => p.texto)).toEqual(['👥 5', '✋ 1', '2 trabalhando', '1 à toa', '1 concluído']);
    expect(pecasDaPlaca(r, true).map((p) => p.texto)).toEqual(['👥 5', '✋ 1', '2', '1', '1']);
    expect(pecasDaPlaca(r, true).map((p) => p.estado ?? (p.alerta ? 'alerta' : '-'))).toEqual(['-', 'alerta', 'trabalhando', 'aToa', 'concluido']);
  });

  it('estado zerado não aparece', () => {
    const r = roda([sub('a', 'working', 1), sub('b', 'done', 2), sub('c', 'done', 3)]);
    expect(pecasDaPlaca(r, false).map((p) => p.texto)).toEqual(['👥 3', '1 trabalhando', '2 concluídos']);
  });
});

describe('lista da roda', () => {
  const medir = (t: string) => t.length * 6;

  it('título: o time, senão o pai, senão a sala', () => {
    expect(tituloDaRoda(roda([sub('a', 'working', 1, { teamName: 'gauntlet' })]), () => 'Sara')).toBe('Time gauntlet · 1 na roda');
    expect(tituloDaRoda(roda([sub('a', 'working', 1)]), (id) => (id === 'pai' ? 'Sara' : undefined))).toBe('Subagentes de Sara · 1 na roda');
    expect(tituloDaRoda(roda([sub('a', 'working', 1), sub('b', 'working', 2, { parentId: 'outro' })]), () => 'Sara')).toBe('Subagentes da sala · 2 na roda');
  });

  it('quem espera você vem primeiro; cada estado com a contagem e os nomes lado a lado', () => {
    const r = roda([sub('ana', 'working', 1), sub('bia', 'waiting', 2), sub('caio', 'done', 3), sub('davi', 'working', 4)]);
    const l = linhasDaLista(r, 284, medir);
    expect(l.map((x) => (x.tipo === 'secao' ? x.texto : x.itens.map((i) => i.texto).join(',')))).toEqual(['✋ Espera você · 1', 'bia', 'Trabalhando · 2', 'ana,davi', 'Concluído · 1', 'caio']);
    const nomes = l.find((x) => x.tipo === 'nomes' && x.itens.length === 2);
    expect(nomes?.tipo === 'nomes' && nomes.itens.map((i) => [i.id, i.x])).toEqual([
      ['ana', 0],
      ['davi', 28],
    ]);
  });

  it('nomes que não cabem em três linhas viram "e mais N", que cabe na última', () => {
    const membros = Array.from({ length: 40 }, (_, i) => sub(`agente-${String(i).padStart(2, '0')}`, 'working', i));
    const l = linhasDaLista(roda(membros), 284, medir);
    const linhas = l.filter((x) => x.tipo === 'nomes');
    expect(linhas).toHaveLength(3);
    const ultima = linhas[2].tipo === 'nomes' ? linhas[2].itens : [];
    const mais = ultima.at(-1)!;
    expect(mais.id).toBeUndefined();
    const mostrados = linhas.reduce((n, x) => n + (x.tipo === 'nomes' ? x.itens.filter((i) => i.id).length : 0), 0);
    expect(mais.texto).toBe(`e mais ${40 - mostrados}`);
    expect(mais.x + mais.w).toBeLessThanOrEqual(284);
    for (const x of linhas) if (x.tipo === 'nomes') for (const i of x.itens) expect(i.x + i.w).toBeLessThanOrEqual(284);
  });
});
