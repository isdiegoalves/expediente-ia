import { describe, expect, it } from 'vitest';
import { esperaPorSala, linkListaDeEspera, LINK_LISTA_DE_ESPERA, textoPrecisamDeVoce } from './espera';

describe('texto da espera', () => {
  it('singular e plural', () => {
    expect(textoPrecisamDeVoce(1)).toBe('1 precisa de você');
    expect(textoPrecisamDeVoce(4)).toBe('4 precisam de você');
  });
});

describe('balão por sala', () => {
  const a = (id: string, roomId: string, visivel = true) => ({ id, roomId, visivel });

  it('cada sala com quem espera ganha um balão, com a contagem e uma âncora estável', () => {
    const m = esperaPorSala([a('z', 'r1'), a('b', 'r1'), a('c', 'r1'), a('x', 'r2'), a('p', 'r3'), a('q', 'r3')]);
    expect([...m.keys()].sort()).toEqual(['r1', 'r2', 'r3']);
    expect(m.get('r1')).toEqual({ ancora: 'b', total: 3 });
    expect(m.get('r2')).toEqual({ ancora: 'x', total: 1 });
    expect(m.get('r3')).toEqual({ ancora: 'p', total: 2 });
  });

  it('a âncora é um agente visível, mas a contagem inclui quem está fora da tela', () => {
    expect(esperaPorSala([a('a', 'r', false), a('b', 'r'), a('c', 'r')]).get('r')).toEqual({ ancora: 'b', total: 3 });
  });

  it('sem ninguém esperando, nenhum balão', () => {
    expect(esperaPorSala([]).size).toBe(0);
  });

  it('sala sem ninguém visível não tem balão', () => {
    expect(esperaPorSala([a('a', 'r', false), a('b', 'r', false)]).size).toBe(0);
  });
});

describe('link da lista de espera do app', () => {
  it('só quando alguém que espera roda no app desktop', () => {
    expect(linkListaDeEspera([{ status: 'waiting', origin: 'app desktop' }])).toBe(LINK_LISTA_DE_ESPERA);
    expect(linkListaDeEspera([{ status: 'waiting', origin: 'terminal' }, { status: 'working', origin: 'app desktop' }])).toBeUndefined();
    expect(linkListaDeEspera([])).toBeUndefined();
  });
});
