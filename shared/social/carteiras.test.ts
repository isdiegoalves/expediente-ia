// Carteiras: saldo inicial, tarefas pagas uma vez, apostas sem saldo negativo e o formato do arquivo.
import { describe, expect, it } from 'vitest';
import { DELIVERY_REWARD, START_COINS, TASK_REWARD, Wallets } from './carteiras';

const T0 = 1_700_000_000_000;

describe('carteira', () => {
  const ana = { id: 'ana', name: 'Ana', kind: 'main' as const, tasks: [] as { id: string; title: string; status: string }[] };

  it('quem chega entra com o saldo inicial; tarefas já concluídas são pagas em silêncio, uma vez', () => {
    const w = new Wallets();
    const sub = { id: 's1', name: 'Rui', kind: 'sub' as const, tasks: [] };
    expect(w.ensure(sub, T0).created).toBe(true);
    expect(w.coins('s1')).toBe(START_COINS.sub);
    const done = { ...ana, tasks: [{ id: '1', title: 'Login', status: 'completed' }, { id: '2', title: 'Testes', status: 'pending' }] };
    expect(w.ensure(done, T0).created).toBe(true);
    expect(w.coins('ana')).toBe(START_COINS.main + TASK_REWARD);
    expect(w.payTasks(done, T0)).toBe(0);
    expect(w.ensure(done, T0).created).toBe(false);
  });

  it('cada tarefa concluída paga uma vez (lista refeita com o mesmo id e outro título paga de novo)', () => {
    const w = new Wallets();
    w.ensure(ana, T0);
    const t1 = { ...ana, tasks: [{ id: '1', title: 'Login', status: 'completed' }] };
    expect(w.payTasks(t1, T0)).toBe(TASK_REWARD);
    expect(w.payTasks(t1, T0)).toBe(0);
    const t2 = { ...ana, tasks: [{ id: '1', title: 'Cadastro', status: 'completed' }] };
    expect(w.payTasks(t2, T0)).toBe(TASK_REWARD);
    expect(w.get('ana')!.ledger[0]).toMatchObject({ delta: TASK_REWARD, text: 'Tarefa concluída: Cadastro' });
    expect(w.credit('ana', DELIVERY_REWARD, '📦', 'Entregou', T0)).toBe(DELIVERY_REWARD);
    expect(w.get('ana')!.earned).toBe(START_COINS.main + 2 * TASK_REWARD + DELIVERY_REWARD);
  });

  it('aposta: nunca deixa saldo negativo; placar e extrato dos dois lados', () => {
    const w = new Wallets();
    w.ensure(ana, T0);
    w.ensure({ id: 'bia', name: 'Bia', kind: 'sub', tasks: [] }, T0);
    expect(w.transfer('bia', 'ana', 50, '✊', 'no jokenpô', T0)).toBe(START_COINS.sub);
    expect(w.coins('bia')).toBe(0);
    expect(w.coins('ana')).toBe(START_COINS.main + START_COINS.sub);
    expect(w.transfer('bia', 'ana', 10, '✊', 'no jokenpô', T0)).toBe(0);
    expect(w.get('ana')!.ledger[0].text).toBe('Ganhou no jokenpô de Bia');
    expect(w.get('bia')!.ledger[0].text).toBe('Perdeu no jokenpô para Ana');
    w.recordMatch('ana', 'bia');
    expect(w.get('ana')).toMatchObject({ wins: 1, losses: 0, vs: { bia: [1, 0] } });
    expect(w.get('bia')).toMatchObject({ wins: 0, losses: 1, vs: { ana: [0, 1] } });
  });

  it('vai e volta pelo arquivo; esquece quem sumiu há dias; o que estiver fora do formato fica de fora', () => {
    const w = new Wallets();
    w.ensure(ana, T0);
    w.credit('ana', 7, '💬', 'Pedido atendido', T0);
    const again = new Wallets(JSON.parse(JSON.stringify(w.toJSON())));
    expect(again.coins('ana')).toBe(START_COINS.main + 7);
    expect(again.get('ana')!.ledger[0]).toMatchObject({ delta: 7, text: 'Pedido atendido' });
    again.ensure({ id: 'velho', name: 'Velho', kind: 'main', tasks: [] }, T0 - 10 * 24 * 3_600_000);
    again.prune(T0);
    expect(again.get('velho')).toBeUndefined();
    expect(again.takeDirty()).toBe(true);
    expect(again.takeDirty()).toBe(false);
    const torto = new Wallets({ ana: { coins: 'muito' }, bia: { coins: 12.7, vs: { ana: [1, 'x'] }, ledger: [{ text: 1 }] }, nada: null });
    expect(torto.get('ana')).toBeUndefined();
    expect(torto.get('bia')).toMatchObject({ coins: 12, vs: {}, ledger: [] });
    expect(new Wallets('{lixo').coins('ana')).toBe(0);
  });
});
