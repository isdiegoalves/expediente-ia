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

describe('o mesmo saldo no snapshot e no resumo do mod', () => {
  let server: http.Server;
  let base: string;
  let office: Office;
  let hub: Hub;
  let livro: LivroSocial;

  beforeEach(async () => {
    const accounts = new AccountsService({ dirs: [], home: dir, env: {}, onChange: () => undefined });
    const late: { livro?: LivroSocial } = {};
    office = new Office({
      names: new NameStore(null),
      version: 't',
      startedAt: 0,
      accounts: () => [],
      sources: () => [],
      accountName: () => undefined,
      social: () => late.livro?.estado(),
    });
    hub = new Hub(office, { throttleMs: 10 });
    hub.start();
    livro = new LivroSocial({ arquivo: join(dir, SOCIAL_ARQUIVO), agentes: () => hub.current().agents, mudou: () => office.markDirty() });
    late.livro = livro;
    const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false });
    const guard = createRequestGuard();
    server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      api(req, res, new URL(req.url ?? '/', 'http://x'));
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    hub.stop();
    server.closeAllConnections();
    await new Promise((ok) => server.close(ok));
  });

  it('o snapshot leva as carteiras e o /api/mod/summary (e o texto do /escritorio) mostra o mesmo saldo', async () => {
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
