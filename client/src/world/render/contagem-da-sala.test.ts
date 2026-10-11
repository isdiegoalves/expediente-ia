// Pílula da sala e balão "N precisam de você" com gente na roda da equipe (subagente sem personagem).
import { describe, expect, it } from 'vitest';
import { esperaPorSala, type EsperaDaSala } from '../../../../shared/espera';
import type { AgentInfo, AgentStatus } from '../../../../shared/types';
import { montarRoda } from '../sim/fanout';
import { pessoasNaSala, quemEspera, type PersonagemNaSala } from './contagem-da-sala';
import { Overlay } from './overlay';

const T0 = 1_700_000_000_000;

function sub(id: string, status: AgentStatus, roomId = '/a'): AgentInfo {
  return { id, kind: 'sub', parentId: 'pai', roomId, name: id, look: 'f', role: 'Explore', sessionId: 's', account: '.claude', status, recent: [], tasks: [], startedAt: T0, lastEventAt: T0, statusSince: T0, stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 }, seed: 1 };
}

function personagem(mode: string, roomId = '/a', leaving = false): PersonagemNaSala {
  return { roomId, leaving, mode };
}

/** O principal e os oito subagentes animados da sala /a; `volta` perdeu a vaga e ainda anda até a roda; um vizinho em /b. */
function emCena(modoDosOito = 'work'): Map<string, PersonagemNaSala> {
  return new Map([
    ['pai', personagem('work')],
    ...Array.from({ length: 8 }, (_, i): [string, PersonagemNaSala] => [`p${i}`, personagem(modoDosOito)]),
    ['volta', personagem('leave', '/a', true)],
    ['vizinho', personagem('work', '/b')],
  ]);
}

const todosAVista = () => true;

describe('pílula da sala', () => {
  it('soma quem está na roda aos personagens da sala', () => {
    const roda = montarRoda('/a', Array.from({ length: 42 }, (_, i) => sub(`r${i}`, i < 27 ? 'working' : 'done')));
    expect(pessoasNaSala('/a', emCena(), roda)).toBe(9 + 42);
  });

  it('quem ainda anda de volta para a roda conta pelo personagem: só volta à conta quando chega nela', () => {
    const roda = montarRoda('/a', [sub('volta', 'working'), ...Array.from({ length: 41 }, (_, i) => sub(`r${i}`, 'working'))]);
    expect(pessoasNaSala('/a', emCena(), roda)).toBe(9 + 41);
  });

  it('sem roda, só os personagens da sala que não estão indo embora', () => {
    expect(pessoasNaSala('/a', emCena(), undefined)).toBe(9);
    expect(pessoasNaSala('/b', emCena(), undefined)).toBe(1);
  });
});

describe('balão "N precisam de você" da visão geral', () => {
  it('mais gente esperando do que vagas: os oito personagens e os dois que ficaram na roda somam dez', () => {
    const roda = montarRoda('/a', [sub('r0', 'waiting'), sub('r1', 'waiting'), sub('r2', 'working'), sub('r3', 'done')]);
    const esperando = quemEspera(emCena('wait'), [roda], todosAVista);
    expect(esperando.filter((q) => !q.visivel).map((q) => q.id)).toEqual(['r0', 'r1']);
    expect(esperaPorSala(esperando).get('/a')).toEqual({ ancora: 'p0', total: 10 });
  });

  it('um personagem esperando e dois na roda: o balão dele diz três', () => {
    const personagens = emCena().set('p3', personagem('wait'));
    const roda = montarRoda('/a', [sub('r0', 'waiting'), sub('r1', 'waiting'), sub('r2', 'working')]);
    expect(esperaPorSala(quemEspera(personagens, [roda], todosAVista)).get('/a')).toEqual({ ancora: 'p3', total: 3 });
  });

  it('só quem está na roda espera: ninguém serve de apoio, e a sala fica sem balão (a placa da roda mostra o ✋)', () => {
    const roda = montarRoda('/a', [sub('r0', 'waiting'), sub('r1', 'waiting')]);
    const esperando = quemEspera(emCena(), [roda], todosAVista);
    expect(esperando).toEqual([
      { id: 'r0', roomId: '/a', visivel: false },
      { id: 'r1', roomId: '/a', visivel: false },
    ]);
    expect(esperaPorSala(esperando).has('/a')).toBe(false);
  });

  it('membro da roda que ainda tem personagem não entra pela roda', () => {
    const roda = montarRoda('/a', [sub('volta', 'waiting'), sub('r1', 'waiting')]);
    expect(quemEspera(emCena(), [roda], todosAVista).map((q) => q.id)).toEqual(['r1']);
  });

  it('personagem indo embora não conta, e quem está fora da tela conta sem servir de apoio', () => {
    const personagens = emCena().set('p3', personagem('wait')).set('p5', personagem('wait')).set('p7', personagem('wait', '/a', true));
    const esperando = quemEspera(personagens, [], (id) => id !== 'p3');
    expect(esperando).toEqual([
      { id: 'p3', roomId: '/a', visivel: false },
      { id: 'p5', roomId: '/a', visivel: true },
    ]);
    expect(esperaPorSala(esperando).get('/a')).toEqual({ ancora: 'p5', total: 2 });
  });

  it('cada roda conta para a própria sala', () => {
    const personagens = emCena().set('p3', personagem('wait')).set('vizinho', personagem('wait', '/b'));
    const rodas = [montarRoda('/a', [sub('r0', 'working')]), montarRoda('/b', [sub('b0', 'waiting', '/b'), sub('b1', 'waiting', '/b')])];
    const porSala = esperaPorSala(quemEspera(personagens, rodas, todosAVista));
    expect(porSala.get('/a')).toEqual({ ancora: 'p3', total: 1 });
    expect(porSala.get('/b')).toEqual({ ancora: 'vizinho', total: 3 });
  });
});

describe('no overlay, a pílula e o balão recebem a roda da equipe', () => {
  /** Os dois métodos do overlay que contam, chamados só com o que leem dele: rodam sem canvas. */
  const overlay = Overlay.prototype as unknown as { countIn(roomId: string): number; esperaDasSalas(vw: number, vh: number): Map<string, EsperaDaSala> | null };
  const oito = new Map(Array.from({ length: 8 }, (_, i): [string, PersonagemNaSala] => [`p${i}`, personagem('wait')]));
  const roda = montarRoda('/a', [sub('r0', 'waiting'), sub('r1', 'waiting'), sub('r2', 'working')]);
  const tela = {
    sim: { chars: oito, fanout: { rodas: new Map([['/a', roda]]) } },
    renderer: { heads: new Map([...oito.keys()].map((id) => [id, { visible: true, x: 100, y: 100 }])) },
    sx: (x: number) => x,
    sy: (y: number) => y,
  };

  it('a pílula soma os oito personagens e os três da roda', () => {
    expect(overlay.countIn.call(tela, '/a')).toBe(11);
  });

  it('o balão soma os oito personagens que esperam e os dois que esperam na roda', () => {
    expect(overlay.esperaDasSalas.call(tela, 1440, 900)?.get('/a')).toEqual({ ancora: 'p0', total: 10 });
  });
});
