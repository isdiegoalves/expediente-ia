import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { moveAgent, orderAgents } from './agentorder';

const KEY = 'expediente:ordem-agentes';
let data: Map<string, string>;

beforeEach(() => {
  data = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

interface A {
  id: string;
  sessionId: string;
}
const a = (id: string): A => ({ id, sessionId: `s-${id}` });
const ids = (xs: A[]) => xs.map((x) => x.id);

describe('ordem dos agentes na lista lateral', () => {
  it('sem ordem guardada mantém a ordem recebida', () => {
    expect(ids(orderAgents('sala', [a('1'), a('2')], (x) => x.sessionId))).toEqual(['1', '2']);
  });
  it('mover grava pela sessão com a chave do Expediente e quem não está na ordem vai para o fim', () => {
    const items = [a('1'), a('2'), a('3')];
    expect(moveAgent('sala', items, (x) => x.id, (x) => x.sessionId, '3', '1', false)).toBe(true);
    expect(JSON.parse(data.get(KEY)!)).toEqual({ sala: ['s-3', 's-1', 's-2'] });
    expect(ids(orderAgents('sala', [a('4'), a('1'), a('3')], (x) => x.sessionId))).toEqual(['3', '1', '4']);
  });
  it('mover para depois do alvo e destino inexistente', () => {
    const items = [a('1'), a('2'), a('3')];
    expect(moveAgent('sala', items, (x) => x.id, (x) => x.sessionId, '1', '2', true)).toBe(true);
    expect(JSON.parse(data.get(KEY)!).sala).toEqual(['s-2', 's-1', 's-3']);
    expect(moveAgent('sala', items, (x) => x.id, (x) => x.sessionId, '1', 'x', true)).toBe(false);
  });
  it('valor guardado de outro formato não quebra a leitura', () => {
    const items = [a('1'), a('2')];
    for (const ruim of ['{oops', '[]', '"x"', '{"sala":"texto"}', '{"sala":{"a":1}}', '{"sala":[1,null]}']) {
      data.set(KEY, ruim);
      expect(ids(orderAgents('sala', items, (x) => x.sessionId)), ruim).toEqual(['1', '2']);
    }
    data.set(KEY, '{"sala":["s-2",7,null],"outra":5}');
    expect(ids(orderAgents('sala', items, (x) => x.sessionId))).toEqual(['2', '1']);
  });
});
