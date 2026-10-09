import { spawn } from 'node:child_process';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { hookJson } from './permission-server';

const HOOK = resolve(__dirname, '../../mod/expediente-permissoes/hooks/permission-hook.mjs');
const { parseOptions } = (await import(pathToFileURL(HOOK).href)) as { parseOptions(argv: string[], env: NodeJS.ProcessEnv): { port: number; timeoutMs: number } };

interface Reply {
  status: number;
  body?: string;
  drop?: boolean;
  hang?: boolean;
}
interface Fake {
  port: number;
  posted: string[];
  close(): Promise<void>;
}

function fake(register: Reply, wait: Reply = { status: 200, body: '{"status":"pending"}' }): Promise<Fake> {
  const posted: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const isPost = req.method === 'POST';
      if (isPost) posted.push(Buffer.concat(chunks).toString('utf8'));
      const r = isPost ? register : wait;
      if (r.hang) return;
      if (r.drop) return void req.socket.destroy();
      res.writeHead(r.status, { 'Content-Type': 'application/json' }).end(r.body ?? '');
    });
  });
  return new Promise((ok) =>
    server.listen(0, '127.0.0.1', () =>
      ok({
        port: (server.address() as AddressInfo).port,
        posted,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      }),
    ),
  );
}

function runHook(stdin: string, args: string[]): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
  return new Promise((ok, fail) => {
    const t0 = Date.now();
    const child = spawn(process.execPath, [HOOK, ...args], { env: { PATH: process.env.PATH, HOME: '/nao/existe' }, stdio: ['pipe', 'pipe', 'pipe'] });
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

let srv: Fake | undefined;
afterEach(async () => {
  await srv?.close();
  srv = undefined;
});

const REGISTRADO: Reply = { status: 201, body: '{"id":"p1"}' };

describe('permission-hook.mjs: qualquer falha devolve a decisão ao terminal', () => {
  const registro: Array<[string, Reply]> = [
    ['registro com 403', { status: 403, body: '{"error":"desligado"}' }],
    ['registro com 404', { status: 404 }],
    ['registro com 500', { status: 500, body: '{"error":"x"}' }],
    ['registro com resposta que não é JSON', { status: 201, body: '<html>não sou JSON' }],
    ['registro 201 sem id', { status: 201, body: '{}' }],
    ['registro com conexão derrubada', { status: 0, drop: true }],
  ];
  it.each(registro)('%s: sai com 0 e sem decisão', async (_nome, reply) => {
    srv = await fake(reply);
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)]);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeLessThan(4_000);
  });

  const espera: Array<[string, Reply]> = [
    ['espera com 403', { status: 403 }],
    ['espera com 404', { status: 404 }],
    ['espera com 500', { status: 500, body: '{"error":"x"}' }],
    ['espera com resposta que não é JSON', { status: 200, body: 'lixo{' }],
    ['espera com JSON sem decisão válida', { status: 200, body: '{"status":"decided","behavior":"talvez"}' }],
    ['espera com conexão derrubada', { status: 0, drop: true }],
  ];
  it.each(espera)('%s: sai com 0 e sem decisão', async (_nome, reply) => {
    srv = await fake(REGISTRADO, reply);
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)]);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeLessThan(4_000);
  });

  it('prazo esgotado com o servidor pendurado: sai com 0, sem decisão, perto do prazo', async () => {
    srv = await fake(REGISTRADO, { status: 0, hang: true });
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port), '--timeout', '5']);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeGreaterThanOrEqual(4_500);
    expect(r.ms).toBeLessThan(13_000);
  }, 30_000);

  it('prazo esgotado com o servidor sempre "pending": sai com 0 e sem decisão', async () => {
    srv = await fake(REGISTRADO);
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port), '--timeout', '5']);
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(r.ms).toBeGreaterThanOrEqual(4_500);
    expect(r.ms).toBeLessThan(8_000);
  }, 20_000);

  it('o prazo padrão é de 5 minutos', () => {
    expect(parseOptions([], {}).timeoutMs).toBe(5 * 60 * 1_000);
  });

  it('o corpo enviado ao servidor não contém transcript_path', async () => {
    srv = await fake({ status: 403 });
    const input = hookJson({ tool_input: { command: 'ls' } });
    await runHook(JSON.stringify(input), ['--port', String(srv.port)]);
    expect(srv.posted).toHaveLength(1);
    const body = JSON.parse(srv.posted[0]) as Record<string, unknown>;
    expect(body.session_id).toBe(input.session_id);
    expect(Object.keys(body)).not.toContain('transcript_path');
    expect(srv.posted[0]).not.toContain('/tmp/x/projects');
  });
});
