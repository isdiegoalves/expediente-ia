import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IrInfo, OfficeSnapshot } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { Hub } from '../http/sse';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { urlPermitida } from '../http/ir';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from './fixtures';

setQuiet(true);

const SESSAO = '0a1b2c3d-1111-2222-3333-444455556666';
const APP = 'local_5e6f7a8b-aaaa-bbbb-cccc-ddddeeeeffff';
const GHP = `ghp_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6'}`;

interface Resp {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

let relogio = 1_000_000;
let server: http.Server;
let base: string;
let office: Office;
let cleanup: () => void;

function pedir(path: string, headers: Record<string, string> = {}, method = 'GET'): Promise<Resp> {
  const u = new URL(base);
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

const ir = async (id: string): Promise<IrInfo> => JSON.parse((await pedir(`/api/agentes/${encodeURIComponent(id)}/ir`)).body) as IrInfo;
const abrir = (id: string, nonce: string | undefined, headers: Record<string, string> = {}) =>
  pedir(`/api/agentes/${encodeURIComponent(id)}/ir?abrir=1&n=${nonce ?? ''}`, headers);

function agente(id: string, extra: { entrypoint?: string; kind?: string; cwd?: string; encerrado?: boolean; sessionId?: string }): void {
  office.addMain({
    id,
    account: 'a',
    sessionId: extra.sessionId ?? SESSAO,
    cwd: extra.cwd ?? '/p/loja',
    role: 'Agente principal',
    startedAt: 1,
    status: 'working',
    entrypoint: extra.entrypoint,
    kind: extra.kind,
  });
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
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  cleanup();
});

describe('GET /api/agentes/:id/ir', () => {
  it('agente vivo do app: cópia com fork rotulada e o botão que abre o projeto', async () => {
    agente('a:1', { entrypoint: 'claude-desktop' });
    const res = await pedir('/api/agentes/a%3A1/ir');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const j = JSON.parse(res.body) as IrInfo;
    expect(j.estado).toBe('vivo');
    expect(j.comando).toBe(`claude --resume ${SESSAO} --fork-session`);
    expect(j.aviso).toBe('cria uma cópia, não responde à sessão original');
    expect(j.links).toEqual([
      { rotulo: 'Abrir a sessão no app', href: `claude://code/continue?session=${APP}` },
      { rotulo: 'Abrir o projeto no app', href: 'claude://code/new?folder=%2Fp%2Floja' },
    ]);
    expect(j.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it('o link direto da sessão só sai para agente vivo do app com sessão casada', async () => {
    agente('a:6', { entrypoint: 'claude-desktop', sessionId: 'sem-par-no-mapa' });
    agente('a:7', { entrypoint: 'cli', kind: 'interactive' });
    agente('a:8', { entrypoint: 'claude-desktop', encerrado: true });
    for (const id of ['a:6', 'a:7', 'a:8']) {
      expect((await ir(id)).links.map((l) => l.href).filter((h) => h.startsWith('claude://code/continue'))).toEqual([]);
    }
  });

  it('terminal vivo: attach se kind=bg, fork rotulado se interactive', async () => {
    agente('a:2', { entrypoint: 'cli', kind: 'bg' });
    agente('a:3', { entrypoint: 'cli', kind: 'interactive', sessionId: 'outra-sessao' });
    const bg = await ir('a:2');
    expect(bg.comando).toBe(`claude attach ${SESSAO}`);
    expect(bg.aviso).toBeUndefined();
    expect(bg.links).toEqual([{ rotulo: 'Abrir o projeto no terminal', href: 'claude-cli://open?cwd=%2Fp%2Floja' }]);
    const inter = await ir('a:3');
    expect(inter.comando).toBe('claude --resume outra-sessao --fork-session');
    expect(inter.aviso).toBe('cria uma cópia, não responde à sessão original');
  });

  it('sessão encerrada: cd e resume; CLI ganha o terceiro botão, app não', async () => {
    agente('a:4', { entrypoint: 'cli', kind: 'interactive', encerrado: true });
    agente('a:5', { entrypoint: 'claude-desktop', encerrado: true, sessionId: 'sessao-do-app' });
    const cli = await ir('a:4');
    expect(cli.estado).toBe('encerrado');
    expect(cli.comando).toBe(`cd /p/loja && claude --resume ${SESSAO}`);
    expect(cli.aviso).toBeUndefined();
    expect(cli.links.map((l) => l.href)).toEqual(['claude-cli://open?cwd=%2Fp%2Floja', `claude://resume?session=${SESSAO}`]);
    const app = await ir('a:5');
    expect(app.links.map((l) => l.href)).toEqual(['claude://code/new?folder=%2Fp%2Floja']);
  });

  it('o caminho vai entre aspas e sai mascarado', async () => {
    agente('a:6', { entrypoint: 'cli', encerrado: true, cwd: `/p/minha loja/${GHP}` });
    const j = await ir('a:6');
    expect(j.comando).toContain("cd '/p/minha loja/");
    expect(JSON.stringify(j)).not.toContain(GHP);
  });

  it('o caminho completo e o comando nunca vão para o snapshot', async () => {
    agente('a:1', { entrypoint: 'claude-desktop', cwd: '/Users/ficticio/projetos/loja' });
    const snap = (await pedir('/api/snapshot')).body;
    expect(snap).not.toContain('/Users/ficticio');
    expect(snap).not.toContain('--fork-session');
    expect(JSON.stringify((JSON.parse(snap) as OfficeSnapshot).agents)).not.toContain('nonce');
  });

  it('agente desconhecido leva 404; POST leva 405', async () => {
    expect((await pedir('/api/agentes/nao-existe/ir')).status).toBe(404);
    expect((await pedir('/api/agentes/a%3A1/ir', { 'content-type': 'application/json' }, 'POST')).status).toBe(405);
  });

  it('id de sessão fora do padrão não vira comando', async () => {
    agente('a:7', { entrypoint: 'cli', sessionId: 'x; rm -rf ~' });
    expect((await pedir('/api/agentes/a%3A7/ir')).status).toBe(404);
  });
});

describe('GET /api/agentes/:id/ir?abrir=1', () => {
  beforeEach(() => agente('a:1', { entrypoint: 'claude-desktop' }));

  it('sem nonce leva 403', async () => {
    const res = await pedir('/api/agentes/a%3A1/ir?abrir=1');
    expect(res.status).toBe(403);
    expect(res.headers.location).toBeUndefined();
  });

  it('nonce válido leva 302 para a URL da lista permitida', async () => {
    const { nonce } = await ir('a:1');
    const res = await abrir('a:1', nonce);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`claude://code/continue?session=${APP}`);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('nonce reusado leva 403', async () => {
    const { nonce } = await ir('a:1');
    expect((await abrir('a:1', nonce)).status).toBe(302);
    expect((await abrir('a:1', nonce)).status).toBe(403);
  });

  it('nonce vencido leva 403', async () => {
    const { nonce } = await ir('a:1');
    relogio += 60_001;
    expect((await abrir('a:1', nonce)).status).toBe(403);
  });

  it('nonce de outro agente leva 403', async () => {
    agente('a:2', { entrypoint: 'claude-desktop', sessionId: 'x' });
    const { nonce } = await ir('a:2');
    expect((await abrir('a:1', nonce)).status).toBe(403);
  });

  it('Sec-Fetch-Site: cross-site leva 403 e não gasta o nonce', async () => {
    const { nonce } = await ir('a:1');
    expect((await abrir('a:1', nonce, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await abrir('a:1', nonce, { 'Sec-Fetch-Site': 'same-site' })).status).toBe(403);
    expect((await abrir('a:1', nonce, { 'Sec-Fetch-Site': 'none' })).status).toBe(302);
    const outro = await ir('a:1');
    expect((await abrir('a:1', outro.nonce, { 'Sec-Fetch-Site': 'same-origin' })).status).toBe(302);
  });

  it('agente sem sessão do app casada leva 409 e nada é lançado', async () => {
    agente('a:3', { entrypoint: 'cli', sessionId: 'y' });
    const { nonce } = await ir('a:3');
    const res = await abrir('a:3', nonce);
    expect(res.status).toBe(409);
    expect(res.headers.location).toBeUndefined();
  });

  it('300 pedidos para um agente não invalidam o nonce de outro', async () => {
    agente('a:2', { entrypoint: 'claude-desktop', sessionId: 'x' });
    const { nonce } = await ir('a:1');
    for (let i = 0; i < 300; i++) await ir('a:2');
    expect((await abrir('a:1', nonce)).status).toBe(302);
  });

  it('o nonce novo do agente substitui o anterior dele', async () => {
    const velho = (await ir('a:1')).nonce;
    const novo = (await ir('a:1')).nonce;
    expect((await abrir('a:1', velho)).status).toBe(403);
    expect((await abrir('a:1', novo)).status).toBe(302);
  });

  it('pedido de outra origem não recebe nonce nem derruba o do agente', async () => {
    const { nonce } = await ir('a:1');
    for (const site of ['cross-site', 'same-site']) {
      const res = await pedir('/api/agentes/a%3A1/ir', { 'Sec-Fetch-Site': site });
      expect(res.status).toBe(200);
      expect((JSON.parse(res.body) as IrInfo).nonce).toBeUndefined();
    }
    expect((await abrir('a:1', nonce)).status).toBe(302);
  });
});

describe('urlPermitida', () => {
  it('só os links do app com id no formato certo', () => {
    expect(urlPermitida(`claude://code/continue?session=${APP}`)).toBe(true);
    expect(urlPermitida(`claude://code/needs-input?session=${APP}`)).toBe(true);
    expect(urlPermitida(`claude://resume?session=${SESSAO}`)).toBe(true);
    for (const ruim of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://evil.example',
      'claude://code/continue?session=abc',
      `claude://code/continue?session=${APP}&x=1`,
      'claude://code/new?folder=%2Fp',
      `claude://resume?session=${SESSAO}&x=1`,
      `claude://other?session=${SESSAO}`,
    ])
      expect(urlPermitida(ruim), ruim).toBe(false);
  });
});
