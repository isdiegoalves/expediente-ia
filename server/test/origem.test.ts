import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';

setQuiet(true);

const CLI_APP = '11111111-aaaa-4aaa-8aaa-111111111111';
const CLI_APP_2 = '22222222-bbbb-4bbb-8bbb-222222222222';
const BEARER = 'Bearer fictici0TokenValue1234567890';

function office(mapa: () => ReadonlyMap<string, string>): Office {
  return new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    sessoesApp: mapa,
    now: () => 1_000_000,
  });
}

const main = (o: Office, n: number, sessionId: string, registro: { entrypoint?: string; kind?: string }) =>
  o.addMain({ id: `acc:${n}`, account: 'acc', sessionId, cwd: `/p/proj${n}`, role: 'Agente principal', startedAt: 1, status: 'idle', ...registro });

describe('selo de origem do agente', () => {
  it('app casado leva o local_; terminal, sdk e segundo plano saem sem id do app', () => {
    const o = office(() => new Map([[CLI_APP, 'local_um']]));
    main(o, 1, CLI_APP, { entrypoint: 'claude-desktop', kind: 'interactive' });
    main(o, 2, 'cli-1', { entrypoint: 'cli', kind: 'interactive' });
    main(o, 3, 'sdk-1', { entrypoint: 'sdk-py' });
    main(o, 4, 'bg-1', { entrypoint: 'cli', kind: 'bg' });
    main(o, 5, 'app-sem-mapa', { entrypoint: 'claude-desktop' });
    const por = Object.fromEntries(o.commit().snapshot.agents.map((a) => [a.id, a]));
    expect(por['acc:1']).toMatchObject({ origin: 'app desktop', appSessionId: 'local_um' });
    expect(por['acc:2']?.origin).toBe('terminal');
    expect(por['acc:3']?.origin).toBe('sdk');
    expect(por['acc:4']?.origin).toBe('segundo plano');
    expect(por['acc:5']?.origin).toBe('app desktop');
    for (const id of ['acc:2', 'acc:3', 'acc:4', 'acc:5']) expect(por[id]?.appSessionId, id).toBeUndefined();
    expect(o.detail('acc:1')?.agent).toMatchObject({ origin: 'app desktop', appSessionId: 'local_um' });
    expect(o.detail('acc:2')?.agent.appSessionId).toBeUndefined();
  });

  it('/clear no app: o casamento acompanha o sessionId novo', () => {
    const o = office(() => new Map([[CLI_APP, 'local_um'], [CLI_APP_2, 'local_dois']]));
    main(o, 1, CLI_APP, { entrypoint: 'claude-desktop' });
    expect(o.commit().snapshot.agents[0]?.appSessionId).toBe('local_um');
    o.switchSession('acc:1', CLI_APP_2);
    expect(o.commit().snapshot.agents[0]?.appSessionId).toBe('local_dois');
  });

  it('subagente não leva selo', () => {
    const o = office(() => new Map([[CLI_APP, 'local_um']]));
    main(o, 1, CLI_APP, { entrypoint: 'claude-desktop' });
    o.addSub({ id: 's:sub', parentId: 'acc:1', sessionId: CLI_APP, role: 'Explore', background: false, startedAt: 2 });
    const sub = o.commit().snapshot.agents.find((a) => a.kind === 'sub');
    expect(sub?.origin).toBeUndefined();
    expect(sub?.appSessionId).toBeUndefined();
  });

  it('o id do app passa pela função única de saída', () => {
    const o = office(() => new Map([[CLI_APP, `local_x ${BEARER}`]]));
    main(o, 1, CLI_APP, { entrypoint: 'claude-desktop' });
    const saida = JSON.stringify([o.commit().snapshot, o.detail('acc:1')]);
    expect(saida).toContain('"origin":"app desktop"');
    expect(saida).not.toContain('fictici0TokenValue');
  });
});

describe('arquivo da ponte do app', () => {
  it('fica ao lado da pasta do uso: ~/.expediente/host por padrão e /host no container', () => {
    expect(loadConfig({ HOME: '/home/fulano' }, [], false).sessoesAppFile).toBe('/home/fulano/.expediente/host/sessoes-app.json');
    expect(loadConfig({ HOME: '/root', EXPEDIENTE_USAGE_DIR: '/host/uso' }, [], true).sessoesAppFile).toBe('/host/sessoes-app.json');
  });
});
