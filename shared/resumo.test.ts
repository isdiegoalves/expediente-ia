import { describe, expect, it } from 'vitest';
import { montarResumo, tarefaDaSessao } from './resumo';
import type { AgentInfo, RoomInfo } from './types';

const GHP = `ghp_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6'}`;
const SAIU = 1_000_000;
const AGORA = SAIU + 2 * 3_600_000;

function agent(p: Partial<AgentInfo> & Pick<AgentInfo, 'id'>): AgentInfo {
  return {
    kind: 'main',
    roomId: 'loja',
    name: p.id,
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${p.id}`,
    account: '.claude',
    status: 'working',
    recent: [],
    tasks: [],
    startedAt: 0,
    lastEventAt: 0,
    statusSince: SAIU - 60_000,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: 1,
    ...p,
  };
}

const rooms: RoomInfo[] = [{ id: 'loja', name: 'loja-virtual', path: '/p/loja', slot: 0, seed: 1, createdAt: 0 }];
const resumo = (agents: AgentInfo[], opts = {}) => montarResumo({ agents, rooms }, SAIU, AGORA, opts);

describe('contagens', () => {
  const agents = [
    agent({ id: 'a', status: 'idle', statusSince: SAIU + 10 }),
    agent({ id: 'b', status: 'idle', statusSince: SAIU + 20 }),
    agent({ id: 'c', status: 'idle', statusSince: SAIU - 5 }),
    agent({ id: 'd', status: 'waiting', waitingFor: 'aprovar uma permissão', statusSince: SAIU + 30 }),
    agent({ id: 'e', status: 'working' }),
    agent({ id: 'e:sub', kind: 'sub', parentId: 'e', sessionId: 's-e', status: 'working', agentName: 'revisor', parado: { desde: SAIU + 40, erro: 'API 529: sobrecarregada' } }),
    agent({ id: 'f', status: 'working' }),
    agent({ id: 'g', status: 'offline' }),
  ];

  it('terminaram só quem ficou à toa depois que você saiu; quem já estava à toa é ociosa', () => {
    const r = resumo(agents);
    expect(r.terminaram).toBe(2);
    expect(r.sessoes.find((s) => s.id === 'c')?.estado).toBe('ociosa');
  });

  it('esperam: as sessões que pedem você, com o motivo', () => {
    const r = resumo(agents);
    expect(r.esperam).toBe(1);
    expect(r.sessoes.find((s) => s.id === 'd')).toMatchObject({ estado: 'espera', motivo: 'aprovar uma permissão' });
  });

  it('travaram: a sessão cujo subagente parou, com o erro como motivo', () => {
    const r = resumo(agents);
    expect(r.travaram).toBe(1);
    expect(r.sessoes.find((s) => s.id === 'e')).toMatchObject({ estado: 'travou', motivo: 'revisor: API 529: sobrecarregada' });
  });

  it('trabalhando e a ordem: esperam, travaram, terminaram, trabalhando, ociosas; sessão encerrada fica de fora', () => {
    const r = resumo(agents);
    expect(r.trabalhando).toBe(1);
    expect(r.sessoes.map((s) => s.id)).toEqual(['d', 'e', 'b', 'a', 'f', 'c']);
  });

  it('a própria sessão e os subagentes dela não entram', () => {
    const r = resumo(agents, { propria: { account: '.claude', session: 's-d' } });
    expect(r.esperam).toBe(0);
    expect(r.sessoes.map((s) => s.id)).not.toContain('d');
  });

  it('o que o isReal recusa (demo) não entra', () => {
    const r = resumo(agents, { isReal: (id: string) => id !== 'a' });
    expect(r.terminaram).toBe(1);
  });
});

describe('última tarefa', () => {
  const t = (id: string, status: 'pending' | 'in_progress' | 'completed', title: string, activeForm?: string) => ({ id, status, title, ...(activeForm ? { activeForm } : {}) });

  it('a última em andamento, na forma de gerúndio quando houver', () => {
    const a = agent({ id: 'a', title: 'Pedido', tasks: [t('1', 'in_progress', 'Antiga'), t('2', 'completed', 'Feita'), t('3', 'in_progress', 'Escrever testes', 'Escrevendo testes')] });
    expect(tarefaDaSessao(a)).toEqual({ rotulo: 'Em andamento', texto: 'Escrevendo testes' });
  });

  it('sem nada em andamento, a próxima pendente', () => {
    const a = agent({ id: 'a', title: 'Pedido', tasks: [t('1', 'completed', 'Feita'), t('2', 'pending', 'Subir o deploy')] });
    expect(tarefaDaSessao(a)).toEqual({ rotulo: 'Próxima', texto: 'Subir o deploy' });
  });

  it('sem tarefas, o título da sessão (o último pedido)', () => {
    expect(tarefaDaSessao(agent({ id: 'a', title: 'Corrigir o login' }))).toEqual({ rotulo: 'Último pedido', texto: 'Corrigir o login' });
    expect(tarefaDaSessao(agent({ id: 'a' }))).toBeUndefined();
  });

  it('segredo no título, na tarefa, no motivo e no nome passa pela máscara', () => {
    const a = agent({
      id: 'a',
      status: 'waiting',
      waitingFor: `usar ${GHP}`,
      title: `Deploy com ${GHP}`,
      tasks: [t('1', 'in_progress', `Chamar a API com ${GHP}`)],
    });
    const r = resumo([a, agent({ id: 'b', status: 'working', name: `Bia ${GHP}`, tasks: [t('1', 'pending', `Rodar ${GHP}`)] })]);
    const texto = JSON.stringify(r);
    expect(texto).not.toContain(GHP);
    expect(texto).not.toContain('aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6');
    expect(r.sessoes[0].motivo).toContain('***');
  });
});
