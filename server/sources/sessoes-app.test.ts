import { mkdirSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from '../test/fixtures';
import { MAX_IDADE_PONTE_MS, origemDoAgente, parseSessoesApp, SessoesAppReader } from './sessoes-app';

const NOW = 1_800_000_000_000;
const CLI_A = '11111111-aaaa-4aaa-8aaa-111111111111';
const CLI_B = '22222222-bbbb-4bbb-8bbb-222222222222';
const SENTINELA = 'SENTINELA-NAO-PODE-SAIR';

const arquivo = (sessoes: unknown[], geradoEm = NOW) => JSON.stringify({ geradoEm, sessoes });

describe('parseSessoesApp', () => {
  it('casa cliSessionId com o local_ da sessão do app e ignora as arquivadas', () => {
    const m = parseSessoesApp(
      arquivo([
        { sessionId: 'local_um', cliSessionId: CLI_A, isArchived: false },
        { sessionId: 'local_dois', cliSessionId: CLI_B, isArchived: true },
        { sessionId: 'local_tres', isArchived: false },
      ]),
    );
    expect(m?.porCli).toEqual(new Map([[CLI_A, 'local_um']]));
    expect(m?.geradoEm).toBe(NOW);
  });

  it('só lê as 3 chaves: campo extra e id fora do formato do app não passam', () => {
    const m = parseSessoesApp(
      arquivo([
        { sessionId: 'local_um', cliSessionId: CLI_A, isArchived: false, title: SENTINELA },
        { sessionId: `local_/${SENTINELA}`, cliSessionId: CLI_B, isArchived: false },
      ]),
    );
    expect(JSON.stringify([...(m?.porCli ?? [])])).not.toContain(SENTINELA);
    expect([...(m?.porCli.values() ?? [])]).toEqual(['local_um']);
  });

  it('formato estranho = undefined', () => {
    expect(parseSessoesApp('{')).toBeUndefined();
    expect(parseSessoesApp('[]')).toBeUndefined();
    expect(parseSessoesApp(JSON.stringify({ sessoes: [] }))).toBeUndefined();
    expect(parseSessoesApp(JSON.stringify({ geradoEm: NOW, sessoes: 'x' }))).toBeUndefined();
  });
});

describe('SessoesAppReader', () => {
  let tmp: ReturnType<typeof tempDir>;
  let file: string;
  beforeEach(() => {
    tmp = tempDir();
    mkdirSync(join(tmp.dir, 'host'));
    file = join(tmp.dir, 'host', 'sessoes-app.json');
  });
  afterEach(() => tmp.cleanup());

  it('lê o arquivo; sem arquivo, mapa vazio', () => {
    const r = new SessoesAppReader(file);
    expect(r.read(NOW).size).toBe(0);
    writeFileSync(file, arquivo([{ sessionId: 'local_um', cliSessionId: CLI_A, isArchived: false }]));
    expect(r.read(NOW).get(CLI_A)).toBe('local_um');
  });

  it('ponte com mais de 60 s é ignorada (sem mod rodando)', () => {
    writeFileSync(file, arquivo([{ sessionId: 'local_um', cliSessionId: CLI_A, isArchived: false }]));
    const r = new SessoesAppReader(file);
    expect(r.read(NOW + MAX_IDADE_PONTE_MS).get(CLI_A)).toBe('local_um');
    expect(r.read(NOW + MAX_IDADE_PONTE_MS + 1).size).toBe(0);
  });

  it('arquivo ilegível no meio de uma troca mantém a última versão boa', () => {
    writeFileSync(file, arquivo([{ sessionId: 'local_um', cliSessionId: CLI_A, isArchived: false }]));
    const r = new SessoesAppReader(file);
    expect(r.read(NOW).get(CLI_A)).toBe('local_um');
    writeFileSync(file, '{"geradoEm": 1800000');
    utimesSync(file, new Date(NOW + 5_000), new Date(NOW + 5_000));
    expect(r.read(NOW + 1_000).get(CLI_A)).toBe('local_um');
  });
});

describe('origemDoAgente', () => {
  it('app casado: app desktop com o local_ resolvido', () => {
    expect(origemDoAgente({ entrypoint: 'claude-desktop', kind: 'interactive' }, 'local_um')).toEqual({ origin: 'app desktop', appSessionId: 'local_um' });
  });

  it('entrypoint do app sem casamento: app desktop, sem id', () => {
    expect(origemDoAgente({ entrypoint: 'claude-desktop' }, undefined)).toEqual({ origin: 'app desktop' });
  });

  it('cli = terminal; sdk-py e sdk-cli = sdk; kind bg = segundo plano; nenhum leva id do app', () => {
    expect(origemDoAgente({ entrypoint: 'cli', kind: 'interactive' })).toEqual({ origin: 'terminal' });
    expect(origemDoAgente({ entrypoint: 'sdk-py' })).toEqual({ origin: 'sdk' });
    expect(origemDoAgente({ entrypoint: 'sdk-cli' })).toEqual({ origin: 'sdk' });
    expect(origemDoAgente({ entrypoint: 'cli', kind: 'bg' })).toEqual({ origin: 'segundo plano' });
    expect(origemDoAgente({ kind: 'background' })).toEqual({ origin: 'segundo plano' });
  });

  it('sessão que não é do app não ganha id do app nem se o mapa casar', () => {
    expect(origemDoAgente({ entrypoint: 'cli' }, 'local_um')).toEqual({ origin: 'terminal' });
    expect(origemDoAgente({ entrypoint: 'sdk-py' }, 'local_um')).toEqual({ origin: 'sdk' });
    expect(origemDoAgente({ entrypoint: 'cli', kind: 'bg' }, 'local_um')).toEqual({ origin: 'segundo plano' });
  });

  it('sem entrypoint nem kind conhecidos: sem selo', () => {
    expect(origemDoAgente({})).toBeUndefined();
    expect(origemDoAgente({ entrypoint: 'outra-coisa' })).toBeUndefined();
  });
});
