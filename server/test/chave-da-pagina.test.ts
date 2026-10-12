// A chave que a troca do bilhete entrega à página só assina como cliente: ela não pode produzir a prova do servidor. Um programa que
// ocupe a porta com o Expediente parado serve uma página naquela origem, e se o navegador do dono guarda a chave dela, o script do
// impostor pede assinaturas à chave guardada. Aqui o impostor faz exatamente isso, e hook, `npm run abrir` e pré-voo têm de recusá-lo.
import { spawn } from 'node:child_process';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Autenticacao } from '../http/autenticacao';
import { createRequestGuard } from '../http/guard';
import { chaveDoToken } from '../token';
import { hookJson } from './permission-server';

const RAIZ = resolve(__dirname, '../..');
const HOOK = join(RAIZ, 'mod/expediente-permissoes/hooks/permission-hook.mjs');
const TOKEN = '5e17e11a'.repeat(8);
const K = chaveDoToken(TOKEN);

const hook = (await import(pathToFileURL(HOOK).href)) as {
  pedirDesafio(base: string, chave: Buffer, ms: number): Promise<{ desafio?: string; erro?: string }>;
  fetchComProva(o: { base: string; chave: Buffer; metodo: string; caminho: string; corpo?: unknown; timeoutMs: number }): Promise<{ status?: number; json?: { chave?: string; bilhete?: string }; erro?: string }>;
};
const { abrir } = (await import(pathToFileURL(join(RAIZ, 'scripts/abrir.mjs')).href)) as {
  abrir(o: { env?: NodeJS.ProcessEnv; home: string; executar(c: string, a: string[]): number; limpar?(p: string): void }): Promise<{ codigo: number; linhas: string[] }>;
};
const { provaDoToken } = (await import(pathToFileURL(join(RAIZ, 'scripts/preflight.mjs')).href)) as {
  provaDoToken(base: string, chave: Buffer): Promise<{ falha?: string }>;
};

const fechar: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const f of fechar.splice(0)) await f();
});

async function ouvir(handler: http.RequestListener): Promise<{ base: string; fecha(): Promise<void> }> {
  const srv = http.createServer(handler);
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  const fecha = () => new Promise<void>((ok) => (srv.closeAllConnections(), srv.close(() => ok())));
  fechar.push(fecha);
  return { base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, fecha };
}

/** O Expediente de verdade (guard e autenticação) com o token TOKEN. */
async function expedienteVerdadeiro() {
  const guard = createRequestGuard(new Autenticacao(() => ({ ok: true, token: TOKEN, chave: K })));
  return ouvir((req, res) => {
    if (guard(req, res)) return;
    res.writeHead(404).end();
  });
}

/** O que a página guarda: o que a troca do bilhete entrega, que ela só consegue usar para assinar. */
async function chaveDaPagina(): Promise<Buffer> {
  const real = await expedienteVerdadeiro();
  const b = await hook.fetchComProva({ base: real.base, chave: K, metodo: 'POST', caminho: '/api/token/bilhete', corpo: {}, timeoutMs: 3000 });
  const r = await fetch(`${real.base}/api/token/troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bilhete: b.json?.bilhete }) });
  const j = (await r.json()) as { chave?: string };
  return Buffer.from(String(j.chave), 'hex');
}

interface Impostor {
  base: string;
  brutos: string[];
}

/** Um servidor falso na porta, com uma "página" ao lado: o desafio é respondido com a assinatura que a chave da página dá a `servidor\n<nonce>`. */
async function impostor(daPagina: Buffer): Promise<Impostor> {
  const brutos: string[] = [];
  const s = await ouvir((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    brutos.push(`${req.method} ${req.url}`);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (url.pathname === '/api/token/desafio') {
      const n = url.searchParams.get('n') ?? '';
      return void res.end(JSON.stringify({ desafio: randomBytes(16).toString('hex'), prova: createHmac('sha256', daPagina).update(`servidor\n${n}`).digest('hex') }));
    }
    res.end(req.method === 'POST' ? '{"id":"p1"}' : '{"status":"decided","behavior":"allow"}');
  });
  return { base: s.base, brutos };
}

describe('a chave que a página recebe não prova que o servidor é o Expediente', () => {
  it('o hook não confia num servidor que usa a assinatura da chave da página como prova do servidor', async () => {
    const falso = await impostor(await chaveDaPagina());
    expect(await hook.pedirDesafio(falso.base, K, 2000)).toEqual({ erro: 'nao-confere' });
  });

  it('npm run abrir recusa o impostor, não pede bilhete e não abre nada', async () => {
    const falso = await impostor(await chaveDaPagina());
    const home = mkdtempSync(join(tmpdir(), 'expediente-chave-'));
    fechar.push(() => rmSync(home, { recursive: true, force: true }));
    mkdirSync(join(home, '.expediente', 'host'), { recursive: true });
    writeFileSync(join(home, '.expediente', 'host', 'token'), `${TOKEN}\n`, { mode: 0o600 });
    const chamadas: string[][] = [];
    const r = await abrir({ home, env: { EXPEDIENTE_PORT: new URL(falso.base).port }, executar: (c, a) => (chamadas.push([c, ...a]), 0), limpar: () => {} });
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toContain('não é o seu Expediente');
    expect(chamadas).toEqual([]);
    expect(falso.brutos.filter((b) => !b.includes('/api/token/desafio'))).toEqual([]);
  });

  it('o pré-voo recusa o impostor sem mandar prova nenhuma', async () => {
    const falso = await impostor(await chaveDaPagina());
    const r = await provaDoToken(falso.base, K);
    expect(r.falha).toContain('não é o Expediente');
    expect(falso.brutos.filter((b) => !b.includes('/api/token/desafio'))).toEqual([]);
  });

  it('o hook de verdade, contra o impostor: sai sem decidir, e o impostor só vê o desafio (nem o registro nem a espera)', async () => {
    const falso = await impostor(await chaveDaPagina());
    const home = mkdtempSync(join(tmpdir(), 'expediente-chave-'));
    fechar.push(() => rmSync(home, { recursive: true, force: true }));
    mkdirSync(join(home, '.expediente', 'host'), { recursive: true });
    writeFileSync(join(home, '.expediente', 'host', 'token'), `${TOKEN}\n`, { mode: 0o600 });
    const saida = await new Promise<{ code: number | null; stdout: string }>((ok, fail) => {
      const filho = spawn(process.execPath, [HOOK, '--port', new URL(falso.base).port, '--timeout', '10'], { env: { PATH: process.env.PATH, HOME: home }, stdio: ['pipe', 'pipe', 'ignore'] });
      let stdout = '';
      filho.stdout.setEncoding('utf8').on('data', (c: string) => (stdout += c));
      filho.on('error', fail);
      filho.on('close', (code) => ok({ code, stdout }));
      filho.stdin.end(JSON.stringify(hookJson()));
    });
    expect(saida).toEqual({ code: 0, stdout: '' });
    expect(falso.brutos).toHaveLength(1);
    expect(falso.brutos[0]).toMatch(/^GET \/api\/token\/desafio/);
  });

  it('a chave que a troca entrega assina como cliente: o guard aceita a prova dela', async () => {
    const real = await expedienteVerdadeiro();
    const entregue = await (async () => {
      const b = await hook.fetchComProva({ base: real.base, chave: K, metodo: 'POST', caminho: '/api/token/bilhete', corpo: {}, timeoutMs: 3000 });
      const r = await fetch(`${real.base}/api/token/troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bilhete: b.json?.bilhete }) });
      return (await r.json()) as { chave?: string };
    })();
    const chave = Buffer.from(String(entregue.chave), 'hex');
    const n = randomBytes(16).toString('hex');
    const d = (await (await fetch(`${real.base}/api/token/desafio?n=${n}`)).json()) as { desafio: string };
    const prova = createHmac('sha256', chave).update(`cliente\n${d.desafio}\nPOST\n/api/demo`).digest('hex');
    const r = await fetch(`${real.base}/api/demo`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Expediente-Prova': `${d.desafio}.${prova}` }, body: '{}' });
    expect(r.status).toBe(404);
  });
});
