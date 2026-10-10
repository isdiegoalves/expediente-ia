// Livro das carteiras no servidor: sobrevive ao reinício, não quebra com arquivo cortado e chega ao
// snapshot (todas as abas) e ao GET /api/mod/summary com o mesmo saldo.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseSummary, summaryText } from '../../mod/expediente/hooks/resumo';
import { START_COINS, TASK_REWARD } from '../../shared/social/carteiras';
import type { AgentInfo, ModSummary, OfficeSnapshot } from '../../shared/types';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { LivroSocial, SOCIAL_ARQUIVO } from '../social/livro';
import { tempDir } from './fixtures';

setQuiet(true);

const T0 = 1_700_000_000_000;

function agente(id: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId: '/p',
    name: id[0].toUpperCase() + id.slice(1),
    look: 'f',
    role: 'Agente principal',
    sessionId: `s-${id}`,
    account: 'a',
    status: 'idle',
    recent: [],
    tasks: [],
    startedAt: T0,
    lastEventAt: T0,
    statusSince: T0 - 60_000,
    stats: { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 },
    seed: id.length * 7919,
    ...extra,
  };
}

let dir: string;
let cleanup: () => void;

beforeEach(() => {
  const tmp = tempDir();
  dir = tmp.dir;
  cleanup = tmp.cleanup;
});

afterEach(() => cleanup());

describe('livro das carteiras em <dataDir>/social.json', () => {
  it('sobrevive ao reinício: mesma semente, mesmos saldos e extrato', () => {
    const arquivo = join(dir, SOCIAL_ARQUIVO);
    let agentes = [agente('ana', { status: 'working', tasks: [{ id: '1', title: 'Login', status: 'in_progress' }] }), agente('caio')];
    let agora = T0;
    const primeiro = new LivroSocial({ arquivo, agentes: () => agentes, mudou: () => undefined, now: () => agora });
    primeiro.passo();
    agentes = [{ ...agentes[0], tasks: [{ id: '1', title: 'Login', status: 'completed' }] }, agentes[1]];
    agora += 1_000;
    primeiro.passo();
    primeiro.stop();
    const antes = primeiro.estado();
    expect(antes.carteiras.ana.coins).toBe(START_COINS.main + TASK_REWARD);

    const depois = new LivroSocial({ arquivo, agentes: () => agentes, mudou: () => undefined, now: () => agora });
    agora += 1_000;
    depois.passo();
    expect(depois.estado().semente).toBe(antes.semente);
    expect(depois.estado().carteiras.ana).toEqual(antes.carteiras.ana);
    expect(depois.estado().carteiras.caio.coins).toBe(START_COINS.main);
    // a tarefa já paga não paga de novo depois do reinício
    agora += 1_000;
    depois.passo();
    expect(depois.estado().carteiras.ana.coins).toBe(START_COINS.main + TASK_REWARD);
  });

  it('arquivo cortado não derruba o servidor: começa do zero e grava um arquivo inteiro por cima', () => {
    const arquivo = join(dir, SOCIAL_ARQUIVO);
    writeFileSync(arquivo, '{"v":1,"semente":77,"carteiras":{"ana":{"name":"Ana","coins":5');
    const livro = new LivroSocial({ arquivo, agentes: () => [agente('ana')], mudou: () => undefined, now: () => T0 });
    expect(() => livro.passo()).not.toThrow();
    expect(livro.estado().carteiras.ana.coins).toBe(START_COINS.main);
    livro.stop();
    const j = JSON.parse(readFileSync(arquivo, 'utf8')) as { semente: number; carteiras: Record<string, { coins: number }> };
    expect(j.carteiras.ana.coins).toBe(START_COINS.main);
    expect(j.semente).toBe(livro.estado().semente);
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('sem onde gravar, segue em memória sem lançar', () => {
    writeFileSync(join(dir, 'arquivo'), 'x');
    const livro = new LivroSocial({ arquivo: join(dir, 'arquivo', SOCIAL_ARQUIVO), agentes: () => [agente('ana')], mudou: () => undefined, now: () => T0 });
    livro.passo();
    expect(() => livro.stop()).not.toThrow();
    expect(livro.estado().carteiras.ana.coins).toBe(START_COINS.main);
    expect(existsSync(join(dir, 'arquivo', SOCIAL_ARQUIVO))).toBe(false);
  });

  it('o ritmo sobrevive ao reinício; valor fora da lista ou arquivo cortado volta a normal', () => {
    const arquivo = join(dir, SOCIAL_ARQUIVO);
    const agentes = () => [agente('ana')];
    const primeiro = new LivroSocial({ arquivo, agentes, mudou: () => undefined, now: () => T0 });
    primeiro.mudarRitmo('calm');
    expect(new LivroSocial({ arquivo, agentes, mudou: () => undefined, now: () => T0 }).estado().ritmo).toBe('calm');
    writeFileSync(arquivo, JSON.stringify({ v: 1, semente: 9, ritmo: 'turbo', carteiras: {} }));
    expect(new LivroSocial({ arquivo, agentes, mudou: () => undefined, now: () => T0 }).estado().ritmo).toBe('normal');
    writeFileSync(arquivo, '{"v":1,"semente":9,"ritmo":"calm","carteiras":{"ana":{"coi');
    expect(new LivroSocial({ arquivo, agentes, mudou: () => undefined, now: () => T0 }).estado().ritmo).toBe('normal');
  });

  it('trocar o ritmo no meio do dia avisa as abas na hora e não mexe nas carteiras', () => {
    let avisos = 0;
    const livro = new LivroSocial({ arquivo: null, agentes: () => [agente('ana')], mudou: () => avisos++, now: () => T0 });
    livro.passo();
    const carteiras = livro.estado().carteiras;
    livro.mudarRitmo('lively');
    expect(avisos).toBe(2);
    expect(livro.estado().ritmo).toBe('lively');
    expect(livro.estado().carteiras).toEqual(carteiras);
    livro.mudarRitmo('lively');
    expect(avisos).toBe(2);
  });

  it('avisa o snapshot só quando rodas ou carteiras mudam', () => {
    let avisos = 0;
    let agora = T0;
    const livro = new LivroSocial({ arquivo: null, agentes: () => [agente('ana', { status: 'working' })], mudou: () => avisos++, now: () => agora });
    livro.passo();
    for (let i = 0; i < 5; i++) {
      agora += 1_000;
      livro.passo();
    }
    expect(avisos).toBe(1);
  });
});

interface Servidor {
  base: string;
  office: Office;
  livro: LivroSocial;
  fechar: () => Promise<void>;
}

/** Office, Hub, livro e a API de verdade, atrás do guard, numa porta livre do loopback. */
async function subir(terminal: boolean): Promise<Servidor> {
  const accounts = new AccountsService({ dirs: [], home: dir, env: {}, onChange: () => undefined });
  const late: { livro?: LivroSocial } = {};
  const office = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    social: () => late.livro?.estado(),
  });
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
  const livro = new LivroSocial({ arquivo: join(dir, SOCIAL_ARQUIVO), agentes: () => hub.current().agents, mudou: () => office.markDirty() });
  late.livro = livro;
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false, terminal, mudarRitmo: (r) => livro.mudarRitmo(r) });
  const guard = createRequestGuard();
  const server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    api(req, res, new URL(req.url ?? '/', 'http://x'));
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    office,
    livro,
    fechar: async () => {
      hub.stop();
      server.closeAllConnections();
      await new Promise((ok) => server.close(ok));
    },
  };
}

/** Pedido com cabeçalhos que o fetch não deixa mandar (Host forjado). */
function pedir(base: string, path: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; body: string }> {
  const u = new URL(base);
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, path, method: opts.method ?? 'GET', headers: opts.headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', fail);
    req.end(opts.body);
  });
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

describe('o mesmo saldo no snapshot e no resumo do mod', () => {
  let srv: Servidor;
  beforeEach(async () => {
    srv = await subir(false);
  });
  afterEach(() => srv.fechar());

  it('o snapshot leva as carteiras e o /api/mod/summary (e o texto do /escritorio) mostra o mesmo saldo', async () => {
    const { base, office, livro } = srv;
    office.addMain({ id: 'a:1', account: 'a', sessionId: 's1', cwd: '/p/loja', role: 'Agente principal', startedAt: 1, status: 'idle' });
    office.addMain({ id: 'a:2', account: 'a', sessionId: 's2', cwd: '/p/app', role: 'Agente principal', startedAt: 1, status: 'working' });
    livro.passo();
    const snap = (await (await fetch(`${base}/api/snapshot`)).json()) as OfficeSnapshot;
    expect(snap.social?.carteiras['a:1'].coins).toBe(START_COINS.main);
    expect(snap.social?.semente).toBe(livro.estado().semente);
    const resumo = (await (await fetch(`${base}/api/mod/summary`)).json()) as ModSummary;
    expect(resumo.usage.map((u) => [u.id, u.coins])).toEqual([
      ['a:1', snap.social!.carteiras['a:1'].coins],
      ['a:2', snap.social!.carteiras['a:2'].coins],
    ]);
    const texto = summaryText(parseSummary(JSON.stringify(resumo))!, 'http://localhost:4848');
    expect(texto).toContain(`🪙 ${START_COINS.main}`);
  });
});

describe('ritmo do escritório (POST /api/social/ritmo)', () => {
  const ritmoDoSnapshot = async (base: string) => ((await (await fetch(`${base}/api/snapshot`)).json()) as OfficeSnapshot).social?.ritmo;

  it('grava o ritmo para todas as abas: a resposta confirma, o snapshot leva e o arquivo guarda', async () => {
    const srv = await subir(true);
    try {
      expect(await ritmoDoSnapshot(srv.base)).toBe('normal');
      const res = await fetch(`${srv.base}/api/social/ritmo`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ritmo: 'lively' }) });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ritmo: 'lively' });
      expect(await ritmoDoSnapshot(srv.base)).toBe('lively');
      expect(JSON.parse(readFileSync(join(dir, SOCIAL_ARQUIVO), 'utf8')).ritmo).toBe('lively');
    } finally {
      await srv.fechar();
    }
  });

  it('recusa Host forjado, Origin de fora, corpo sem JSON, ritmo fora da lista e GET; o ritmo não muda', async () => {
    const srv = await subir(true);
    try {
      const port = new URL(srv.base).port;
      const corpo = JSON.stringify({ ritmo: 'calm' });
      const casos: Array<[string, Parameters<typeof pedir>[2], number]> = [
        ['Host de fora', { method: 'POST', headers: { ...JSON_HEADERS, Host: `evil.example:${port}` }, body: corpo }, 403],
        ['Host de IP da rede', { method: 'POST', headers: { ...JSON_HEADERS, Host: `192.168.0.9:${port}` }, body: corpo }, 403],
        ['Origin de fora', { method: 'POST', headers: { ...JSON_HEADERS, Origin: 'http://evil.example' }, body: corpo }, 403],
        ['sem JSON', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: corpo }, 415],
        ['ritmo fora da lista', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ritmo: 'turbo' }) }, 400],
        ['sem ritmo', { method: 'POST', headers: JSON_HEADERS, body: '{}' }, 400],
        ['GET', { method: 'GET' }, 405],
      ];
      for (const [nome, opts, status] of casos) expect((await pedir(srv.base, '/api/social/ritmo', opts)).status, nome).toBe(status);
      expect(await ritmoDoSnapshot(srv.base)).toBe('normal');
    } finally {
      await srv.fechar();
    }
  });

  it('com o terminal desligado (Expediente exposto além do computador) recusa com 403', async () => {
    const srv = await subir(false);
    try {
      const res = await fetch(`${srv.base}/api/social/ritmo`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ ritmo: 'calm' }) });
      expect(res.status).toBe(403);
      expect(await ritmoDoSnapshot(srv.base)).toBe('normal');
    } finally {
      await srv.fechar();
    }
  });
});
