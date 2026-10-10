import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IrInfo } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { PEDIDO_VALIDADE_MS } from '../http/focar';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { NONCE_VALIDADE_MS } from '../http/ir';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from './fixtures';

setQuiet(true);

const SESSAO = '0a1b2c3d-1111-2222-3333-444455556666';
const APP = 'local_5e6f7a8b-aaaa-bbbb-cccc-ddddeeeeffff';

interface Resp {
  status: number;
  body: string;
}

let relogio = 1_000_000;
let server: http.Server;
let base: string;
let office: Office;
let cleanup: () => void;

function pedir(path: string, opts: { method?: string; headers?: Record<string, string>; body?: string; json?: boolean } = {}): Promise<Resp> {
  const u = new URL(base);
  const method = opts.method ?? 'GET';
  const headers = { ...(opts.json === false || method === 'GET' ? {} : { 'content-type': 'application/json' }), ...opts.headers };
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end(opts.body);
  });
}

const ir = async (id: string): Promise<IrInfo> => JSON.parse((await pedir(`/api/agentes/${encodeURIComponent(id)}/ir`)).body) as IrInfo;
const focar = (id: string, n: string | undefined, headers: Record<string, string> = {}, extra: { json?: boolean; body?: string } = {}) =>
  pedir(`/api/agentes/${encodeURIComponent(id)}/focar`, { method: 'POST', headers, body: extra.body ?? JSON.stringify({ n }), json: extra.json });
const pedirFoco = async (id = '.claude:507'): Promise<string> => {
  const { nonce } = await ir(id);
  const r = await focar(id, nonce);
  expect(r.status).toBe(200);
  return (JSON.parse(r.body) as { token: string }).token;
};
const estado = async (token: string) => (JSON.parse((await pedir(`/api/focos/${token}`)).body) as { estado: string }).estado;
const pendentes = async () => (JSON.parse((await pedir('/api/mod/focos')).body) as { focos: { token: string; pid: number }[] }).focos;
const assumir = (token: string, headers: Record<string, string> = {}) => pedir(`/api/mod/focos/${token}/assumir`, { method: 'POST', headers, body: '{}' });
const resultado = (token: string, r: unknown) => pedir(`/api/mod/focos/${token}/resultado`, { method: 'POST', body: JSON.stringify({ resultado: r }) });

function agente(id: string, extra: { entrypoint?: string; kind?: string; encerrado?: boolean } = {}): void {
  office.addMain({ id, account: 'a', sessionId: SESSAO, cwd: '/p/loja', role: 'Agente principal', startedAt: 1, status: 'working', entrypoint: extra.entrypoint ?? 'cli', kind: extra.kind ?? 'interactive' });
  if (extra.encerrado) office.closeMain(id);
}

beforeEach(async () => {
  relogio = 1_000_000;
  const tmp = tempDir();
  cleanup = tmp.cleanup;
  const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => undefined });
  office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    sessoesApp: () => new Map([[SESSAO, APP]]),
  });
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false, now: () => relogio });
  const guard = createRequestGuard();
  server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    api(req, res, new URL(req.url ?? '/', 'http://x'));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  agente('.claude:507');
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  cleanup();
});

describe('GET /api/agentes/:id/ir: oferta de foco', () => {
  it('terminal viva com pid oferece focar; o rótulo do projeto vira "Nova sessão neste projeto"', async () => {
    const j = await ir('.claude:507');
    expect(j.focar).toBe(true);
    expect(j.links).toEqual([{ rotulo: 'Nova sessão neste projeto', href: 'claude-cli://open?cwd=%2Fp%2Floja' }]);
  });

  it('não oferece em terminal encerrada, segundo plano, app desktop nem id sem pid', async () => {
    agente('.claude:508', { encerrado: true });
    agente('.claude:509', { kind: 'bg' });
    agente('.claude:510', { entrypoint: 'claude-desktop' });
    agente('sem-pid');
    for (const id of ['.claude:508', '.claude:509', '.claude:510', 'sem-pid']) expect((await ir(id)).focar).toBeUndefined();
  });

  it('o JSON do /ir para outra origem continua sem nonce', async () => {
    const j = JSON.parse((await pedir('/api/agentes/.claude%3A507/ir', { headers: { 'sec-fetch-site': 'cross-site' } })).body) as IrInfo;
    expect(j.nonce).toBeUndefined();
  });
});

describe('POST /api/agentes/:id/focar: travas', () => {
  it('Host forjado: 403', async () => {
    const { nonce } = await ir('.claude:507');
    expect((await focar('.claude:507', nonce, { host: 'evil.example.com' })).status).toBe(403);
  });

  it('Host que é um IP da rede: 403 (o guard aceita, a rota não)', async () => {
    const { nonce } = await ir('.claude:507');
    expect((await focar('.claude:507', nonce, { host: '192.168.0.9:4848' })).status).toBe(403);
  });

  it('Origin de outro site: 403', async () => {
    const { nonce } = await ir('.claude:507');
    expect((await focar('.claude:507', nonce, { origin: 'https://evil.example.com' })).status).toBe(403);
  });

  it('Sec-Fetch-Site cross-site: 403 e o nonce não é gasto', async () => {
    const { nonce } = await ir('.claude:507');
    expect((await focar('.claude:507', nonce, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect((await focar('.claude:507', nonce, { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
  });

  it('Sec-Fetch-Site none passa', async () => {
    const { nonce } = await ir('.claude:507');
    expect((await focar('.claude:507', nonce, { 'sec-fetch-site': 'none' })).status).toBe(200);
  });

  it('corpo que não é JSON: 415', async () => {
    const { nonce } = await ir('.claude:507');
    expect((await focar('.claude:507', nonce, {}, { json: false })).status).toBe(415);
  });

  it('sem nonce, com nonce inventado, reusado, vencido e de outro agente: 403', async () => {
    agente('.claude:600');
    expect((await focar('.claude:507', undefined)).status).toBe(403);
    expect((await focar('.claude:507', '0'.repeat(32))).status).toBe(403);
    const usado = (await ir('.claude:507')).nonce;
    expect((await focar('.claude:507', usado)).status).toBe(200);
    expect((await focar('.claude:507', usado)).status).toBe(403);
    const vencido = (await ir('.claude:507')).nonce;
    relogio += NONCE_VALIDADE_MS + 1;
    expect((await focar('.claude:507', vencido)).status).toBe(403);
    const doOutro = (await ir('.claude:600')).nonce;
    expect((await focar('.claude:507', doOutro)).status).toBe(403);
  });

  it('agente que não é terminal viva recusa com 409 e não cria pedido', async () => {
    agente('.claude:508', { encerrado: true });
    agente('.claude:510', { entrypoint: 'claude-desktop' });
    for (const id of ['.claude:508', '.claude:510']) {
      const { nonce } = await ir(id);
      expect((await focar(id, nonce)).status).toBe(409);
    }
    expect(await pendentes()).toEqual([]);
  });

  it('só POST', async () => {
    expect((await pedir('/api/agentes/.claude%3A507/focar')).status).toBe(405);
  });
});

describe('pedido de foco', () => {
  it('o pid vem do id do agente, e o corpo não carrega nada além do nonce', async () => {
    const { nonce } = await ir('.claude:507');
    const r = await focar('.claude:507', nonce, {}, { body: JSON.stringify({ n: nonce, pid: 1, argv: ['rm'] }) });
    const token = (JSON.parse(r.body) as { token: string }).token;
    expect(await pendentes()).toEqual([{ token, pid: 507 }]);
  });

  it('um pedido por agente: o novo substitui o anterior', async () => {
    const a = await pedirFoco();
    const b = await pedirFoco();
    expect((await pendentes()).map((p) => p.token)).toEqual([b]);
    expect((await pedir(`/api/focos/${a}`)).status).toBe(404);
  });

  it('vence em 10 s: some dos pendentes, não se assume e o estado é vencido', async () => {
    const token = await pedirFoco();
    relogio += PEDIDO_VALIDADE_MS;
    expect(await estado(token)).toBe('pendente');
    relogio += 1;
    expect(await pendentes()).toEqual([]);
    expect(await estado(token)).toBe('vencido');
    expect((await assumir(token)).status).toBe(410);
  });

  it('assumir é único: o segundo recebe 409 e o pedido sai dos pendentes', async () => {
    const token = await pedirFoco();
    const primeiro = await assumir(token);
    expect(primeiro.status).toBe(200);
    expect(JSON.parse(primeiro.body)).toEqual({ pid: 507 });
    expect((await assumir(token)).status).toBe(409);
    expect(await pendentes()).toEqual([]);
    expect(await estado(token)).toBe('assumido');
  });

  it('o resultado só vale de quem assumiu, uma vez, e o navegador o lê pelo token', async () => {
    const token = await pedirFoco();
    expect((await resultado(token, 'focado')).status).toBe(409);
    await assumir(token);
    expect((await resultado(token, 'qualquer coisa')).status).toBe(400);
    expect((await resultado(token, 'sem-painel')).status).toBe(200);
    expect((await resultado(token, 'focado')).status).toBe(409);
    expect(await estado(token)).toBe('sem-painel');
  });

  it('token desconhecido: 404 para assumir e para consultar', async () => {
    expect((await assumir('0'.repeat(32))).status).toBe(404);
    expect((await pedir(`/api/focos/${'0'.repeat(32)}`)).status).toBe(404);
  });

  it('as rotas do mod e a consulta só atendem Host local', async () => {
    const token = await pedirFoco();
    const h = { host: '192.168.0.9:4848' };
    expect((await pedir('/api/mod/focos', { headers: h })).status).toBe(403);
    expect((await assumir(token, h)).status).toBe(403);
    expect((await pedir(`/api/focos/${token}`, { headers: h })).status).toBe(403);
    expect(await estado(token)).toBe('pendente');
  });
});
