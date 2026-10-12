import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { TOKEN_DE_TESTE } from './fixtures';
import { HOME_DE_TESTE, hookJson } from './permission-server';
import { aleatorioHex, chaveDoToken, provaDoCliente, provaDoServidor } from '../token';

const HOOK = resolve(__dirname, '../../mod/expediente-permissoes/hooks/permission-hook.mjs');
const { parseOptions } = (await import(pathToFileURL(HOOK).href)) as { parseOptions(argv: string[], env: NodeJS.ProcessEnv): { port: number; timeoutMs: number } };

interface Reply {
  status: number;
  body?: string;
  drop?: boolean;
  hang?: boolean;
}
interface Pedido {
  metodo: string;
  url: string;
  prova: string | undefined;
  /** A prova de cliente confere com o token do arquivo do hook, para o método e a URL como chegaram. */
  provaValida: boolean;
  /** Tudo o que chegou (linha de pedido, cabeçalhos e corpo): onde o segredo não pode aparecer. */
  bruto: string;
}
interface Fake {
  port: number;
  posted: string[];
  /** Os pedidos que não são de desafio, na ordem. */
  pedidos: Pedido[];
  /** Quantos desafios pediram. */
  desafios: number;
  /** O nonce de cada desafio pedido, na ordem. */
  nonces: string[];
  close(): Promise<void>;
}

const CHAVE_DE_TESTE = chaveDoToken(TOKEN_DE_TESTE);

/** Um "Expediente" falso: responde o desafio com a prova de quem tem `chave` e o resto com as respostas dadas. */
function fake(register: Reply, wait: Reply = { status: 200, body: '{"status":"pending"}' }, chave: Buffer = CHAVE_DE_TESTE): Promise<Fake> {
  const posted: string[] = [];
  const pedidos: Pedido[] = [];
  const estado = { desafios: 0 };
  const nonces: string[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const corpo = Buffer.concat(chunks).toString('utf8');
      const url = req.url ?? '/';
      if (url.startsWith('/api/token/desafio')) {
        estado.desafios++;
        const n = new URL(url, 'http://x').searchParams.get('n') ?? '';
        nonces.push(n);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ desafio: aleatorioHex(), prova: provaDoServidor(chave, n) }));
        return;
      }
      const prova = req.headers['x-expediente-prova'] as string | undefined;
      const [desafio = '', hex = ''] = (prova ?? '').split('.');
      pedidos.push({
        metodo: req.method ?? '',
        url,
        prova,
        provaValida: /^[0-9a-f]{32}$/.test(desafio) && hex === provaDoCliente(CHAVE_DE_TESTE, desafio, req.method ?? '', url),
        bruto: `${req.method} ${url}\n${JSON.stringify(req.headers)}\n${corpo}`,
      });
      const isPost = req.method === 'POST';
      if (isPost) posted.push(corpo);
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
        pedidos,
        nonces,
        get desafios() {
          return estado.desafios;
        },
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      }),
    ),
  );
}

function runHook(stdin: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<{ code: number | null; stdout: string; stderr: string; ms: number }> {
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

describe('permission-hook.mjs: o token local nunca viaja, e o servidor prova que o tem', () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
  });
  function homeCom(conteudo: string | undefined): string {
    const home = mkdtempSync(join(tmpdir(), 'expediente-hook-'));
    homes.push(home);
    mkdirSync(join(home, '.expediente', 'host'), { recursive: true });
    if (conteudo !== undefined) writeFileSync(join(home, '.expediente', 'host', 'token'), conteudo);
    return home;
  }
  const VALOR = TOKEN_DE_TESTE;

  it.each([['ausente', undefined], ['curto', 'curto\n'], ['vazio', ''], ['com letras fora do hexadecimal', `${'g'.repeat(64)}\n`], ['maiúsculo', `${VALOR.toUpperCase()}\n`]])(
    'arquivo do token %s: o hook nem chama o servidor e sai sem decisão',
    async (_nome, conteudo) => {
      srv = await fake(REGISTRADO);
      const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)], { HOME: homeCom(conteudo) });
      expect(r).toMatchObject({ code: 0, stdout: '' });
      expect(srv.pedidos).toEqual([]);
      expect(srv.desafios).toBe(0);
    },
  );

  it('com o token legível: cada chamada (o registro e a espera) vem depois de um desafio, com a prova certa, e o segredo não aparece em nenhum byte que chegou', async () => {
    srv = await fake(REGISTRADO, { status: 200, body: '{"status":"decided","behavior":"deny"}' });
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)], { HOME: homeCom(`${VALOR}\n`), EXPEDIENTE_HOOK_DEBUG: '1' });
    expect(r.code).toBe(0);
    expect(srv.desafios).toBe(2);
    expect(srv.nonces).toHaveLength(2);
    for (const n of srv.nonces) expect(n).toMatch(/^[0-9a-f]{32}$/);
    expect(srv.nonces[0]).not.toBe(srv.nonces[1]);
    expect(srv.pedidos.map((p) => `${p.metodo} ${p.url.split('?')[0]}`)).toEqual(['POST /api/permissions', 'GET /api/permissions/p1/wait']);
    for (const p of srv.pedidos) {
      expect(p.prova, p.url).toMatch(/^[0-9a-f]{32}\.[0-9a-f]{64}$/);
      expect(p.provaValida, p.url).toBe(true);
      expect(p.bruto).not.toContain(VALOR);
    }
    expect(r.stderr + r.stdout).not.toContain(VALOR);
  });

  it('servidor que não tem o token (quem ocupa a porta com o Expediente parado): o hook não manda registro nem prova, e sai sem decisão', async () => {
    srv = await fake(REGISTRADO, { status: 200, body: '{"status":"decided","behavior":"allow"}' }, chaveDoToken('f'.repeat(64)));
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)], { HOME: homeCom(`${VALOR}\n`), EXPEDIENTE_HOOK_DEBUG: '1' });
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(srv.desafios).toBe(1);
    expect(srv.pedidos).toEqual([]);
    expect(r.stderr).toContain('não é o Expediente');
    expect(r.stderr).not.toContain(VALOR);
  });

  it.each([
    ['sem prova nenhuma', '{"desafio":"' + 'a'.repeat(32) + '"}'],
    ['com a prova de outro nonce (repetição de uma resposta antiga)', '{"desafio":"' + 'a'.repeat(32) + '","prova":"' + 'b'.repeat(64) + '"}'],
    ['com desafio fora do formato', '{"desafio":"curto","prova":"' + 'b'.repeat(64) + '"}'],
    ['que não é JSON', 'lixo'],
  ])('servidor que responde o desafio %s: o hook sai sem decisão e não manda nada', async (_nome, corpo) => {
    const falso = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(corpo);
    });
    await new Promise<void>((ok) => falso.listen(0, '127.0.0.1', ok));
    try {
      const r = await runHook(JSON.stringify(hookJson()), ['--port', String((falso.address() as AddressInfo).port)], { HOME: homeCom(`${VALOR}\n`) });
      expect(r).toMatchObject({ code: 0, stdout: '' });
    } finally {
      falso.closeAllConnections();
      falso.close();
    }
  });

  it.each([401, 403, 503])('o servidor recusa o registro com %i: sai sem decisão e não pergunta mais nada', async (status) => {
    srv = await fake({ status, body: '{"error":"x"}' });
    const r = await runHook(JSON.stringify(hookJson()), ['--port', String(srv.port)], { HOME: homeCom(`${VALOR}\n`) });
    expect(r).toMatchObject({ code: 0, stdout: '' });
    expect(srv.pedidos.map((p) => p.metodo)).toEqual(['POST']);
  });
});
