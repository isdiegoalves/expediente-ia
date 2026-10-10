import { describe, expect, it } from 'vitest';
import type { AgentInfo } from '../../../shared/types';
import { bateStatus, contarPorStatus, esperamNoNo, grupoDoStatus, subirQuemEspera } from './urgencia';

const st = (status: AgentInfo['status']) => ({ status });

describe('filtro por status', () => {
  it('agrupa os status em esperando, trabalhando e à toa', () => {
    expect(grupoDoStatus('waiting')).toBe('esperando');
    expect(grupoDoStatus('working')).toBe('trabalhando');
    expect(grupoDoStatus('shell')).toBe('trabalhando');
    for (const s of ['idle', 'done', 'offline'] as const) expect(grupoDoStatus(s)).toBe('parados');
  });

  it('todos deixa passar tudo; os demais só o próprio grupo', () => {
    expect(bateStatus(st('idle'), 'todos')).toBe(true);
    expect(bateStatus(st('waiting'), 'esperando')).toBe(true);
    expect(bateStatus(st('working'), 'esperando')).toBe(false);
    expect(bateStatus(st('done'), 'parados')).toBe(true);
  });

  it('conta por grupo', () => {
    expect(contarPorStatus([st('waiting'), st('waiting'), st('working'), st('idle')])).toEqual({ todos: 4, esperando: 2, trabalhando: 1, parados: 1 });
  });
});

describe('quem espera sobe', () => {
  it('só quem espera vai para o início, mantendo a ordem arrastada dentro de cada grupo', () => {
    const itens = ['a', 'B', 'c', 'D', 'e'];
    expect(subirQuemEspera(itens, (x) => x === x.toUpperCase())).toEqual(['B', 'D', 'a', 'c', 'e']);
  });

  it('sem ninguém esperando, devolve a mesma ordem e não altera a entrada', () => {
    const itens = ['a', 'b', 'c'];
    expect(subirQuemEspera(itens, () => false)).toEqual(['a', 'b', 'c']);
    expect(itens).toEqual(['a', 'b', 'c']);
  });

  it('um agente com subagente esperando também sobe', () => {
    const n = (status: AgentInfo['status'], subs: AgentInfo['status'][]) => ({ agent: st(status) as AgentInfo, subs: subs.map((s) => st(s) as AgentInfo) });
    expect(esperamNoNo(n('working', ['waiting', 'waiting']))).toBe(2);
    expect(esperamNoNo(n('waiting', ['working']))).toBe(1);
    expect(esperamNoNo(n('idle', []))).toBe(0);
  });
});
