// Hook PermissionRequest (mod/expediente-permissoes/hooks/permission-hook.mjs) rodado como processo de verdade contra o servidor
// de teste: stdin JSON → saída esperada (aprovar, recusar, "sempre permitir", terminal, responder as perguntas
// do AskUserQuestion), saída rápida e sem decisão quando o Expediente está fora do ar, desligado ou sem páginas
// abertas, e o tempo limite.
// Os processos são assíncronos (spawn): o servidor roda neste mesmo processo.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { setQuiet } from '../log';
import { TOKEN_DE_TESTE } from './fixtures';
import { HOME_DE_TESTE, hookJson, MAIN, servePermissions, type PermissionServer } from './permission-server';

setQuiet(true);

const HOOK = resolve(__dirname, '../../mod/expediente-permissoes/hooks/permission-hook.mjs');

/** Funções exportadas pelo hook (JavaScript puro, sem tipos). */
interface HookModule {
  parseOptions(argv: string[], env: NodeJS.ProcessEnv): { port: number; timeoutMs: number };
  requestBody(input: Record<string, unknown>, timeoutMs: number): Record<string, unknown>;
  trimInput(v: unknown, max?: number): unknown;
  decisionOutput(result: unknown, input: unknown): unknown;
}
const { decisionOutput, parseOptions, requestBody, trimInput } = (await import(pathToFileURL(HOOK).href)) as HookModule;

/**
 * tool_input de um AskUserQuestion. Os textos que voltam em `answers` são os ORIGINAIS (o escritório só vê os
 * mascarados): um segredo no rótulo prova isso. A entrada 1 é inválida (pulada; as posições contam no original).
 */
const ASK = {
  questions: [
    { question: 'Qual banco usar?', header: 'Banco', multiSelect: false, options: [{ label: 'Postgres' }, { label: 'Bearer abcdef123456', description: 'o token' }] },
    null,
    { question: 'Quais testes rodar?', header: 'Testes', multiSelect: true, options: [{ label: 'Unidade' }, { label: 'E2E' }, { label: 'Lint' }] },
  ],
  metadata: { source: 'teste' },
};
const askJson = (over: Record<string, unknown> = {}) => hookJson({ tool_name: 'AskUserQuestion', tool_input: ASK, permission_suggestions: [], ...over });

interface HookRun {
  code: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

function runHook(stdin: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<HookRun> {
  return new Promise((ok, fail) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [HOOK, ...args], { env: { PATH: process.env.PATH, HOME: HOME_DE_TESTE, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    child.stderr.setEncoding('utf8').on('data', (c: string) => (stderr += c));
    const kill = setTimeout(() => child.kill('SIGKILL'), 20_000);
    child.on('error', fail);
    child.on('close', (code) => {
      clearTimeout(kill);
      ok({ code, stdout, stderr, ms: Date.now() - t0 });
    });
    child.stdin.end(stdin);
  });
}

/** Espera até o pedido aparecer no registro e devolve o id dele. */
async function pendingId(s: PermissionServer): Promise<string> {
  for (let i = 0; i < 200; i++) {
    const id = s.registry!.snapshot().get(MAIN)?.id;
    if (id) return id;
    await new Promise((ok) => setTimeout(ok, 25));
  }
  throw new Error('o hook não registrou o pedido');
}

/** Porta livre sem ninguém escutando (Expediente "fora do ar"). */
async function deadPort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((ok) => s.listen(0, '127.0.0.1', ok));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((ok) => s.close(() => ok()));
  return port;
}

let srv: PermissionServer | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

describe('permission-hook.mjs (processo)', () => {
  it('aprovar pelo Expediente: imprime a decisão allow e sai com 0', async () => {
    srv = await servePermissions();
    const run = runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)]);
    const id = await pendingId(srv);
    expect(srv.registry!.decide(id, { behavior: 'allow' })).toBe('ok');
    const r = await run;
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } } });
  });

  it('"sempre permitir": aplica a sugestão ORIGINAL do stdin pela posição', async () => {
    srv = await servePermissions();
    const input = hookJson();
    const run = runHook(JSON.stringify(input), ['--port', String(srv.port)]);
    srv.registry!.decide(await pendingId(srv), { behavior: 'allow', suggestion: 0 });
    const out = JSON.parse((await run).stdout);
    expect(out.hookSpecificOutput.decision).toEqual({ behavior: 'allow', updatedPermissions: [(input.permission_suggestions as unknown[])[0]] });
  });

  it('recusar com motivo (e interromper): decisão deny com a mensagem para o agente', async () => {
    srv = await servePermissions();
    const run = runHook(JSON.stringify(hookJson()), [], { EXPEDIENTE_PORT: String(srv.port) });
    srv.registry!.decide(await pendingId(srv), { behavior: 'deny', message: 'use pnpm', interrupt: true });
    const r = await run;
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).hookSpecificOutput.decision).toEqual({ behavior: 'deny', message: 'Recusado pelo usuário no Expediente: use pnpm', interrupt: true });
  });

  it('pergunta respondida no Expediente: aprova com a entrada original mais `answers` (textos originais)', async () => {
    srv = await servePermissions();
    const run = runHook(JSON.stringify(askJson()), ['--port', String(srv.port)]);
    const id = await pendingId(srv);
    // O escritório só viu o rótulo mascarado.
    expect(JSON.stringify(srv.registry!.detail(id)!.questions)).not.toContain('abcdef123456');
    const answers = [{ question: 0, options: [1] }, { question: 2, options: [2, 0], other: 'e o build' }];
    expect(srv.registry!.decide(id, { behavior: 'answer', answers })).toBe('ok');
    const r = await run;
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'allow',
          updatedInput: { ...ASK, answers: { 'Qual banco usar?': 'Bearer abcdef123456', 'Quais testes rodar?': 'Unidade, Lint, e o build' } },
        },
      },
    });
  });

  it('pergunta com token: o escritório vê a versão mascarada e a resposta volta com o texto original do stdin', async () => {
    const ghp = 'ghp_aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6';
    const tool_input = { questions: [{ question: `Usar ${ghp}?`, header: 'Chave', multiSelect: false, options: [{ label: 'Sim' }, { label: 'Não' }] }] };
    srv = await servePermissions();
    const run = runHook(JSON.stringify(askJson({ tool_input })), ['--port', String(srv.port)]);
    const id = await pendingId(srv);
    expect(JSON.stringify(srv.registry!.detail(id)!.questions)).not.toContain('ghp_aB3');
    srv.registry!.decide(id, { behavior: 'answer', answers: [{ question: 0, options: [1] }] });
    const out = JSON.parse((await run).stdout);
    expect(out.hookSpecificOutput.decision.updatedInput.answers).toEqual({ [`Usar ${ghp}?`]: 'Não' });
  });

  it('opção inexistente: o registro recusa a resposta e o hook devolve ao terminal quando o tempo acaba', async () => {
    srv = await servePermissions({ registry: { orphanMs: 300 } });
    const run = runHook(JSON.stringify(askJson()), ['--port', String(srv.port), '--timeout', '5']);
    const id = await pendingId(srv);
    expect(srv.registry!.decide(id, { behavior: 'answer', answers: [{ question: 0, options: [7] }, { question: 2, options: [0] }] })).not.toBe('ok');
    const r = await run;
    expect(r).toMatchObject({ code: 0, stdout: '' });
  }, 20_000);

  it('servidor que devolve resposta inválida: sai sem decisão', async () => {
    const respostas: unknown[] = [
      [{ question: 0, options: [9] }, { question: 2, options: [0] }],
      [{ question: 0, options: [0] }],
      [{ question: 0, options: [0, 1] }, { question: 2, options: [0] }],
      [],
      'texto',
    ];
    for (const answers of respostas) {
      const fake = createHttpServer((req, res) => {
        res.setHeader('Content-Type', 'application/json');
        if (req.method === 'POST') return void res.writeHead(201).end(JSON.stringify({ id: 'p1' }));
        res.writeHead(200).end(JSON.stringify({ status: 'decided', behavior: 'answer', answers }));
      });
      await new Promise<void>((ok) => fake.listen(0, '127.0.0.1', ok));
      try {
        const port = (fake.address() as { port: number }).port;
        const r = await runHook(JSON.stringify(askJson()), ['--port', String(port)]);
        expect(r, JSON.stringify(answers)).toMatchObject({ code: 0, stdout: '' });
      } finally {
        await new Promise((ok) => fake.close(ok));
      }
    }
  });

  it('pergunta sem ninguém olhando ou com o Expediente fora do ar: sai sem decisão', async () => {
    srv = await servePermissions({ viewers: 0 });
    expect(await runHook(JSON.stringify(askJson()), ['--port', String(srv.port)])).toMatchObject({ code: 0, stdout: '' });
    expect(srv.registry!.size).toBe(0);
    expect(await runHook(JSON.stringify(askJson()), ['--port', String(await deadPort())])).toMatchObject({ code: 0, stdout: '' });
  });

  it('pergunta sem resposta até o tempo limite: sai sem decisão', async () => {
    srv = await servePermissions({ registry: { orphanMs: 300 } });
    const r = await runHook(JSON.stringify(askJson()), ['--port', String(srv.port), '--timeout', '5']);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeGreaterThanOrEqual(4_500);
  }, 20_000);

  it('pergunta recusada no Expediente: decisão deny (o agente segue sem a resposta)', async () => {
    srv = await servePermissions();
    const run = runHook(JSON.stringify(askJson()), ['--port', String(srv.port)]);
    srv.registry!.decide(await pendingId(srv), { behavior: 'deny', message: 'decida você' });
    expect(JSON.parse((await run).stdout).hookSpecificOutput.decision).toEqual({ behavior: 'deny', message: 'Recusado pelo usuário no Expediente: decida você' });
  });

  it('"responder no terminal": sai sem decisão (stdout vazio)', async () => {
    srv = await servePermissions();
    const run = runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)]);
    srv.registry!.decide(await pendingId(srv), { behavior: 'terminal' });
    const r = await run;
    expect(r).toMatchObject({ code: 0, stdout: '' });
  });

  it('Expediente fora do ar: sai rápido, sem decisão', async () => {
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(await deadPort())]);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeLessThan(3_000);
  });

  it('recurso desligado (403) ou ninguém olhando: sai na hora, sem decisão', async () => {
    srv = await servePermissions({ enabled: false });
    let r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)]);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeLessThan(3_000);
    await srv.close();
    srv = await servePermissions({ viewers: 0 });
    r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)]);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeLessThan(3_000);
    expect(srv.registry!.size).toBe(0);
  });

  it('stdin inválido, outro evento ou AskUserQuestion sem perguntas: sai sem decisão e sem pedido no Expediente', async () => {
    srv = await servePermissions();
    for (const stdin of ['', 'não é json', '[]', JSON.stringify(hookJson({ hook_event_name: 'PreToolUse' })), JSON.stringify(hookJson({ tool_name: 'AskUserQuestion' }))]) {
      const r = await runHook(stdin, ['--port', String(srv.port)]);
      expect(r, stdin).toMatchObject({ code: 0, stdout: '' });
    }
    expect(srv.registry!.size).toBe(0);
  });

  it('tempo limite (--timeout): desiste, sai sem decisão e o pedido some do escritório', async () => {
    srv = await servePermissions({ registry: { orphanMs: 300 } });
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port), '--timeout', '5']);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeGreaterThanOrEqual(4_500);
    expect(r.ms).toBeLessThan(12_000);
    await new Promise((ok) => setTimeout(ok, 600));
    expect(srv.registry!.size).toBe(0);
  }, 20_000);
});

describe('permission-hook.mjs (funções)', () => {
  it('parseOptions: argumentos, ambiente e limites', () => {
    expect(parseOptions([], {})).toEqual({ port: 4848, timeoutMs: 300_000 });
    expect(parseOptions(['--port', '4851', '--timeout', '60'], {})).toEqual({ port: 4851, timeoutMs: 60_000 });
    expect(parseOptions([], { EXPEDIENTE_PORT: '4848', EXPEDIENTE_PERMISSION_TIMEOUT: '1' })).toEqual({ port: 4848, timeoutMs: 5_000 });
    expect(parseOptions(['--port', 'x', '--timeout', '99999'], {})).toEqual({ port: 4848, timeoutMs: 1_800_000 });
  });

  it('requestBody: só o que o Expediente usa, com textos cortados', () => {
    const body = requestBody(hookJson({ agent_id: 'a1', agent_type: 'Explore', tool_input: { content: 'x'.repeat(20_000) } }), 60_000);
    expect(Object.keys(body).sort()).toEqual(['agent_id', 'agent_type', 'cwd', 'permission_suggestions', 'session_id', 'timeout_ms', 'tool_input', 'tool_name']);
    expect((body.tool_input as { content: string }).content.length).toBe(8_000);
    expect(trimInput({ a: [{ b: 'y'.repeat(9_000) }] })).toEqual({ a: [{ b: 'y'.repeat(8_000) }] });
    // Muitas edições de uma vez: corta mais curto para caber no limite do servidor.
    const edits = Array.from({ length: 60 }, () => ({ old_string: 'o'.repeat(10_000), new_string: 'n'.repeat(10_000) }));
    const big = requestBody(hookJson({ tool_name: 'MultiEdit', tool_input: { file_path: '/a.ts', edits } }), 60_000);
    expect(JSON.stringify(big).length).toBeLessThan(200_000);
    expect((big.tool_input as { edits: Array<{ old_string: string }> }).edits[0].old_string.length).toBe(1_000);
  });

  it('decisionOutput: allow/deny no formato do hook; o resto = sem decisão', () => {
    expect(decisionOutput({ status: 'decided', behavior: 'allow', suggestion: 5 }, hookJson())).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'allow' } },
    });
    expect(decisionOutput({ status: 'decided', behavior: 'deny' }, hookJson())).toEqual({
      hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: { behavior: 'deny', message: 'Recusado pelo usuário no Expediente.' } },
    });
    expect(decisionOutput({ status: 'released', reason: 'terminal' }, hookJson())).toBeUndefined();
    expect(decisionOutput({ status: 'pending' }, hookJson())).toBeUndefined();
    expect(decisionOutput(undefined, hookJson())).toBeUndefined();
  });

  it('decisionOutput: answer troca as posições pelos textos originais; o que não dá para responder = sem decisão', () => {
    const out = (answers: unknown, input: Record<string, unknown> = askJson()) =>
      decisionOutput({ status: 'decided', behavior: 'answer', answers }, input) as { hookSpecificOutput: { decision: { behavior: string; updatedInput: { answers: unknown } } } } | undefined;
    const ok = out([{ question: 2, options: [1] }, { question: 0, other: 'MySQL' }])!;
    expect(ok.hookSpecificOutput.decision.behavior).toBe('allow');
    expect(ok.hookSpecificOutput.decision.updatedInput).toEqual({ ...ASK, answers: { 'Quais testes rodar?': 'E2E', 'Qual banco usar?': 'MySQL' } });
    const single = { question: 0, options: [0] };
    for (const bad of [
      [single], // falta a pergunta 2
      [single, { question: 2, options: [0] }, { question: 2, options: [1] }],
      [single, { question: 1, options: [0] }], // entrada inválida no original
      [single, { question: 2, options: [3] }],
      [single, { question: 2, options: [-1] }],
      [single, { question: 2, options: ['0'] }],
      [single, { question: 2 }],
      [{ question: 0, options: [0, 1] }, { question: 2, options: [0] }], // escolha única com duas
      [{ question: 0, options: [0], other: 'e mais' }, { question: 2, options: [0] }],
      [],
      undefined,
    ]) {
      expect(out(bad), JSON.stringify(bad)).toBeUndefined();
    }
    // Entrada sem perguntas, outra ferramenta, perguntas com o mesmo texto.
    expect(out([single], askJson({ tool_input: {} }))).toBeUndefined();
    expect(out([single], hookJson())).toBeUndefined();
    const twin = { questions: [{ question: 'Igual?', options: [{ label: 'A' }] }, { question: 'Igual?', options: [{ label: 'B' }] }] };
    expect(out([single, { question: 1, options: [0] }], askJson({ tool_input: twin }))).toBeUndefined();
    // Aprovar sem respostas não responde a pergunta: sem decisão. Recusar vale.
    expect(decisionOutput({ status: 'decided', behavior: 'allow' }, askJson())).toBeUndefined();
    expect(decisionOutput({ status: 'decided', behavior: 'deny' }, askJson())).toMatchObject({ hookSpecificOutput: { decision: { behavior: 'deny' } } });
  });
});

describe('permission-hook.mjs e o token local (processo)', () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const h of homes.splice(0)) {
      try {
        chmodSync(join(h, '.expediente', 'host', 'token'), 0o600);
      } catch {
        // sem arquivo: nada a destravar
      }
      rmSync(h, { recursive: true, force: true });
    }
  });

  /** HOME fictício; `conteudo` undefined = sem arquivo do token. */
  function homeCom(conteudo: string | undefined, modo = 0o600): string {
    const home = mkdtempSync(join(tmpdir(), 'expediente-hook-'));
    homes.push(home);
    mkdirSync(join(home, '.expediente', 'host'), { recursive: true });
    if (conteudo !== undefined) writeFileSync(join(home, '.expediente', 'host', 'token'), conteudo, { mode: modo });
    return home;
  }

  async function semDecisao(home: string, depuracao = false): Promise<HookRun> {
    srv = await servePermissions();
    const env: NodeJS.ProcessEnv = { HOME: home, ...(depuracao ? { EXPEDIENTE_HOOK_DEBUG: '1' } : {}) };
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port), '--timeout', '5'], env);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(srv.registry!.size).toBe(0);
    return r;
  }

  it('arquivo do token ausente: sai sem decisão e nem chega a pedir', async () => {
    await semDecisao(homeCom(undefined));
  });

  it('arquivo ilegível (modo 000): sai sem decisão', async () => {
    await semDecisao(homeCom(`${TOKEN_DE_TESTE}\n`, 0o000));
  });

  it('arquivo com formato inválido (curto, vazio, com lixo): sai sem decisão', async () => {
    for (const conteudo of ['abc\n', '', `${TOKEN_DE_TESTE}x\n`, 'g'.repeat(64)]) {
      await semDecisao(homeCom(conteudo));
      await srv?.close();
      srv = undefined;
    }
  });

  it('token errado (o servidor responde 401): sai sem decisão, nada fica pendente e o valor não aparece na depuração', async () => {
    const errado = 'e'.repeat(64);
    const r = await semDecisao(homeCom(`${errado}\n`), true);
    expect(r.stderr).toContain('401');
    expect(r.stderr).not.toContain(errado);
    expect(r.stderr).not.toContain(TOKEN_DE_TESTE);
  });

  it('token certo: o pedido é registrado e a decisão flui; a depuração não mostra o valor', async () => {
    srv = await servePermissions();
    const run = runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)], { HOME: homeCom(`${TOKEN_DE_TESTE}\n`), EXPEDIENTE_HOOK_DEBUG: '1' });
    expect(srv.registry!.decide(await pendingId(srv), { behavior: 'allow' })).toBe('ok');
    const r = await run;
    expect(JSON.parse(r.stdout).hookSpecificOutput.decision).toEqual({ behavior: 'allow' });
    expect(r.stderr).not.toContain(TOKEN_DE_TESTE);
  });
});
