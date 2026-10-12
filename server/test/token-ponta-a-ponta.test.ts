// O servidor de verdade (processo, HOME fictício, porta entre 6740 e 6749) e o hook de verdade: uma escrita sem o
// token não decide a permissão pendente; com o token do arquivo, decide. Nenhuma resposta de leitura nem o log
// do servidor mostra o valor do token.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { OfficeSnapshot } from '../../shared/types';
import { aleatorioHex, chaveDoToken, provaDoCliente, provaDoServidor } from '../token';
import { hookJson } from './permission-server';

const ROOT = resolve(__dirname, '../..');
const HOOK = join(ROOT, 'mod/expediente-permissoes/hooks/permission-hook.mjs');
const SESSAO = 'sess-ponta-a-ponta';
/** Sentinela no lugar do token: 64 hexadecimais que não se confundem com nada do resto das respostas. */
const SENTINELA = '5e17e11a'.repeat(8);

let home: string;
let porta: number;
let servidor: ChildProcess;
let logDoServidor = '';
let viewer: http.ClientRequest;

async function portaLivre(): Promise<number> {
  for (let p = 6740; p <= 6749; p++) {
    const livre = await new Promise<boolean>((ok) => {
      const s = createServer();
      s.once('error', () => ok(false));
      s.listen(p, '127.0.0.1', () => s.close(() => ok(true)));
    });
    if (livre) return p;
  }
  throw new Error('nenhuma porta livre entre 6740 e 6749');
}

function pedir(method: string, path: string, opts: { prova?: string; body?: unknown } = {}, alvo = porta): Promise<{ status: number; text: string }> {
  const data = opts.body === undefined ? undefined : JSON.stringify(opts.body);
  const headers: Record<string, string> = { ...(data ? { 'Content-Type': 'application/json' } : {}), ...(opts.prova !== undefined ? { 'X-Expediente-Prova': opts.prova } : {}) };
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port: alvo, method, path, headers }, (res) => {
      let text = '';
      res.setEncoding('utf8').on('data', (c: string) => (text += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, text }));
    });
    req.on('error', fail);
    req.end(data);
  });
}

/** O que `curl` faria sabendo o token: pede o desafio, confere a prova do servidor e assina o pedido. */
async function pedirComProva(method: string, path: string, opts: { body?: unknown; token?: string } = {}, alvo = porta): Promise<{ status: number; text: string }> {
  const chave = chaveDoToken(opts.token ?? SENTINELA);
  const n = aleatorioHex();
  const d = await pedir('GET', `/api/token/desafio?n=${n}`, {}, alvo);
  if (d.status !== 200) return d;
  const { desafio, prova } = JSON.parse(d.text) as { desafio: string; prova: string };
  // Com `token` o teste finge ser alguém que não tem o segredo: assina assim mesmo, para ver o servidor recusar.
  if (opts.token === undefined && prova !== provaDoServidor(chave, n)) throw new Error('a prova do servidor não confere');
  return pedir(method, path, { body: opts.body, prova: `${desafio}.${provaDoCliente(chave, desafio, method, path)}` }, alvo);
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

async function ate<T>(descricao: string, fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    const v = await fn().catch(() => undefined);
    if (v) return v;
    await esperar(100);
  }
  throw new Error(`não aconteceu a tempo: ${descricao}\n${logDoServidor}`);
}

const snapshot = async () => JSON.parse((await pedir('GET', '/api/snapshot')).text) as OfficeSnapshot;

function rodarHook(): Promise<{ code: number | null; stdout: string }> {
  return new Promise((ok, fail) => {
    const filho = spawn(process.execPath, [HOOK, '--port', String(porta), '--timeout', '30'], { env: { PATH: process.env.PATH, HOME: home }, stdio: ['pipe', 'pipe', 'ignore'] });
    let stdout = '';
    filho.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
    filho.on('error', fail);
    filho.on('close', (code) => ok({ code, stdout }));
    filho.stdin.end(JSON.stringify(hookJson({ session_id: SESSAO, cwd: '/p/loja' })));
  });
}

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'expediente-e2e-'));
  const pasta = join(home, '.claude', 'sessions');
  mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pasta, `${process.pid}.json`), JSON.stringify({ pid: process.pid, sessionId: SESSAO, cwd: '/p/loja', startedAt: Date.now(), kind: 'interactive', entrypoint: 'cli', status: 'busy' }));
  mkdirSync(join(home, '.expediente', 'host'), { recursive: true });
  writeFileSync(join(home, '.expediente', 'host', 'token'), `${SENTINELA}\n`, { mode: 0o600 });
  porta = await portaLivre();
  servidor = spawn(join(ROOT, 'node_modules/.bin/tsx'), ['server/index.ts', '--dev'], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: home, EXPEDIENTE_PORT: String(porta) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servidor.stdout!.setEncoding('utf8').on('data', (c: string) => (logDoServidor += c));
  servidor.stderr!.setEncoding('utf8').on('data', (c: string) => (logDoServidor += c));
  await ate('o servidor responder', async () => (await pedir('GET', '/api/health')).status === 200);
  viewer = http.get({ host: '127.0.0.1', port: porta, path: '/api/stream' }, (res) => res.resume());
  viewer.on('error', () => {});
}, 60_000);

afterAll(async () => {
  viewer?.destroy();
  if (servidor && servidor.exitCode === null) {
    const saiu = new Promise((ok) => servidor.once('exit', ok));
    servidor.kill('SIGTERM');
    await Promise.race([saiu, esperar(5_000)]);
    if (servidor.exitCode === null) servidor.kill('SIGKILL');
  }
  rmSync(home, { recursive: true, force: true });
});

describe('token local, de ponta a ponta', () => {
  it('o servidor usa o arquivo que já existe e não o sobrescreve, e o /api/health diz que as escritas estão liberadas', async () => {
    const arquivo = join(home, '.expediente', 'host', 'token');
    expect(readFileSync(arquivo, 'utf8').trim()).toBe(SENTINELA);
    expect(statSync(arquivo).mode & 0o777).toBe(0o600);
    expect(JSON.parse((await pedir('GET', '/api/health')).text).token).toEqual({ ok: true });
  });

  it('curl sem a prova não decide a permissão pendente (401, continua pendente); com a prova certa, decide', async () => {
    await ate('o agente da sessão aparecer', async () => (await snapshot()).agents.some((a) => a.sessionId === SESSAO));
    const hook = rodarHook();
    const pendente = await ate('a permissão pendente', async () => (await snapshot()).agents.find((a) => a.sessionId === SESSAO)?.permission);
    const decisao = `/api/permissions/${encodeURIComponent(pendente.id)}/decision`;
    const corpo = { behavior: 'allow' };
    const intacta = async () => expect((await snapshot()).agents.find((a) => a.sessionId === SESSAO)?.permission?.id).toBe(pendente.id);

    expect((await pedir('POST', decisao, { body: corpo })).status).toBe(401);
    // O segredo em claro, em qualquer cabeçalho, não vale nada.
    for (const cab of ['', 'errado', SENTINELA, `a.${SENTINELA}`, `${'a'.repeat(32)}.${'b'.repeat(64)}`]) expect((await pedir('POST', decisao, { prova: cab, body: corpo })).status, cab).toBe(401);
    expect((await pedirComProva('POST', decisao, { body: corpo, token: 'f'.repeat(64) })).status).toBe(401);
    await intacta();

    // Quem lê o /api/snapshot vê o id do pedido, mas não decide nem consome a decisão do hook sem a prova.
    expect((await pedir('GET', `/api/permissions/${encodeURIComponent(pendente.id)}/wait?timeout=1`)).status).toBe(401);
    await intacta();

    const ok = await pedirComProva('POST', decisao, { body: corpo });
    expect(ok.status).toBe(200);
    const saida = await hook;
    expect(saida.code).toBe(0);
    expect(JSON.parse(saida.stdout).hookSpecificOutput.decision).toEqual({ behavior: 'allow' });
    await ate('a permissão sair do snapshot', async () => (await snapshot()).agents.find((a) => a.sessionId === SESSAO)?.permission === undefined);
  }, 60_000);

  it('o bilhete leva o segredo ao navegador uma vez só, e só depois de uma escrita com prova', async () => {
    expect((await pedir('POST', '/api/token/bilhete', { body: {} })).status).toBe(401);
    const b = (JSON.parse((await pedirComProva('POST', '/api/token/bilhete', { body: {} })).text) as { bilhete: string }).bilhete;
    expect(b).toMatch(/^[0-9a-f]{32}$/);
    expect((await pedir('POST', '/api/token/troca', { body: { bilhete: aleatorioHex() } })).status).toBe(401);
    const troca = await pedir('POST', '/api/token/troca', { body: { bilhete: b } });
    expect(JSON.parse(troca.text)).toEqual({ token: SENTINELA });
    expect((await pedir('POST', '/api/token/troca', { body: { bilhete: b } })).status).toBe(401);
  });

  it('o valor do token não aparece em nenhuma leitura, em nenhum desafio nem no log do servidor', async () => {
    const snap = await snapshot();
    const agente = snap.agents.find((a) => a.sessionId === SESSAO)!;
    const leituras = [
      '/api/snapshot',
      '/api/health',
      '/api/versao',
      '/api/mod/summary',
      '/api/resumo',
      '/api/stats',
      '/api/stats/days',
      '/api/tema',
      '/api/timeline/days',
      '/api/sessions/recent',
      '/api/mod/focos',
      `/api/agents/${encodeURIComponent(agente.id)}`,
      `/api/agentes/${encodeURIComponent(agente.id)}/ir`,
      `/api/agents/${encodeURIComponent(agente.id)}/terminal`,
      '/api/permissions/nao-existe',
      '/api/permissions/nao-existe/wait?timeout=1',
      '/api/rota-que-nao-existe',
      '/api/token/desafio',
      '/',
    ];
    for (const caminho of leituras) {
      expect((await pedir('GET', caminho)).text, caminho).not.toContain(SENTINELA);
      expect((await pedirComProva('GET', caminho)).text, `${caminho} com prova`).not.toContain(SENTINELA);
    }
    for (let i = 0; i < 3; i++) expect((await pedir('GET', `/api/token/desafio?n=${aleatorioHex()}`)).text).not.toContain(SENTINELA);
    // Escrita recusada e aceita também não ecoam o valor.
    expect((await pedir('POST', '/api/demo', { prova: SENTINELA, body: { enabled: false } })).text).not.toContain(SENTINELA);
    expect((await pedir('POST', '/api/demo', { body: { enabled: false } })).text).not.toContain(SENTINELA);
    expect((await pedirComProva('POST', '/api/demo', { body: { enabled: false } })).text).not.toContain(SENTINELA);
    expect(logDoServidor).toContain('Token local: pronto');
    expect(logDoServidor).not.toContain(SENTINELA);
  });
});

describe('token local: arquivo ausente', () => {
  let casa: string;
  let porta2: number;
  let filho: ChildProcess;

  beforeAll(async () => {
    casa = mkdtempSync(join(tmpdir(), 'expediente-e2e-'));
    porta2 = await portaLivre();
    filho = spawn(join(ROOT, 'node_modules/.bin/tsx'), ['server/index.ts', '--dev'], { cwd: ROOT, env: { PATH: process.env.PATH, HOME: casa, EXPEDIENTE_PORT: String(porta2) }, stdio: 'ignore' });
    await ate('o servidor responder', async () => (await pedir('GET', '/api/health', {}, porta2)).status === 200);
  }, 60_000);

  afterAll(async () => {
    const saiu = new Promise((ok) => filho.once('exit', ok));
    filho.kill('SIGTERM');
    await Promise.race([saiu, esperar(5_000)]);
    if (filho.exitCode === null) filho.kill('SIGKILL');
    rmSync(casa, { recursive: true, force: true });
  });

  const arquivo = () => join(casa, '.expediente', 'host', 'token');
  const demo = (token?: string) => pedirComProva('POST', '/api/demo', { body: { enabled: false }, token }, porta2);

  it('no modo nativo o servidor cria o token (modo 600, 64 hexadecimais) e ele vale', async () => {
    expect(statSync(arquivo()).mode & 0o777).toBe(0o600);
    const token = readFileSync(arquivo(), 'utf8').trim();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect((await pedir('POST', '/api/demo', { body: { enabled: false } }, porta2)).status).toBe(401);
    expect((await demo(token)).status).toBe(200);
    expect((await demo('f'.repeat(64))).status).toBe(401);
  });

  it('apagado ou corrompido o arquivo, toda escrita é recusada (503), o desafio também, e o /api/health diz o motivo; recriado, volta a valer', async () => {
    const token = readFileSync(arquivo(), 'utf8').trim();
    rmSync(arquivo());
    expect((await pedir('POST', '/api/demo', { prova: `${'a'.repeat(32)}.${'b'.repeat(64)}`, body: { enabled: false } }, porta2)).status).toBe(503);
    expect((await pedir('GET', `/api/token/desafio?n=${aleatorioHex()}`, {}, porta2)).status).toBe(503);
    expect(JSON.parse((await pedir('GET', '/api/health', {}, porta2)).text).token).toMatchObject({ ok: false, motivo: expect.stringContaining('token') });
    writeFileSync(arquivo(), 'curto\n', { mode: 0o600 });
    expect((await pedir('POST', '/api/demo', { prova: 'x', body: { enabled: false } }, porta2)).status).toBe(503);
    writeFileSync(arquivo(), `${token}\n`, { mode: 0o600 });
    expect((await demo(token)).status).toBe(200);
  });
});
