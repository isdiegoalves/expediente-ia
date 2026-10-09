// O servidor de verdade alimentando o texto e as ações que o mod desenha: contagem sem a própria sessão, segredo
// mascarado até o texto do /escritorio e o caminho de cada sessão a partir do /ir real.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acoesDaSessao, lerIr } from '../../mod/expediente/hooks/escritorio';
import { parseSummary, statusText, summaryText } from '../../mod/expediente/hooks/resumo';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from './fixtures';

setQuiet(true);

const APP = 'local_5e6f7a8b-aaaa-bbbb-cccc-ddddeeeeffff';
const GHP = `ghp_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6'}`;
const STATS = { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 };

let server: http.Server;
let base: string;
let office: Office;
let cleanup: () => void;

function pedir(path: string): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const u = new URL(base);
  return new Promise((ok, fail) => {
    const req = http.request({ host: u.hostname, port: u.port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c: string) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end();
  });
}

function sessao(id: string, sessionId: string, extra: { status?: 'working' | 'waiting' | 'idle'; entrypoint?: string; kind?: string; title?: string; cwd?: string }): void {
  office.addMain({ id, account: 'a', sessionId, cwd: extra.cwd ?? '/p/loja', role: 'Agente principal', startedAt: 1, status: extra.status ?? 'working', entrypoint: extra.entrypoint, kind: extra.kind, ...(extra.status === 'waiting' ? { waitingFor: 'responder no terminal' } : {}) });
  if (extra.title) office.applyTranscript(id, { title: extra.title, tasks: [], stats: STATS });
}

beforeEach(async () => {
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
    sessoesApp: () => new Map([['s-app', APP]]),
  });
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
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
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
  cleanup();
});

describe('o texto do mod a partir do servidor', () => {
  beforeEach(() => {
    sessao('a:100', 's-propria', { title: 'Esta aqui' });
    office.applyTranscript('a:100', { title: 'Esta aqui', tasks: [], stats: { ...STATS, contextTokens: 50_000, contextWindow: 200_000, costUSD: 1.5 } });
    office.addSub({ id: 's-propria:x1', parentId: 'a:100', sessionId: 's-propria', role: 'Explore', background: true, startedAt: 1 });
    office.setStatus('s-propria:x1', 'waiting', 'aprovar uma permissão');
    sessao('a:101', 's-esperando', { status: 'waiting', entrypoint: 'cli', kind: 'interactive', title: `Subir o deploy com ${GHP}` });
    sessao('a:102', 's-ociosa', { status: 'idle', entrypoint: 'cli', kind: 'interactive' });
    sessao('a:103', 's-trabalhando', { entrypoint: 'cli', kind: 'interactive' });
  });

  it('3 outras sessões e 1 esperando: a linha de status e o /escritorio dizem 1, sem a própria sessão nem os subagentes dela', async () => {
    const resumo = parseSummary((await pedir('/api/mod/summary?account=a&session=s-propria')).body);
    expect(resumo?.waiting.map((w) => w.id)).toEqual(['a:101']);
    expect(statusText(resumo!.waiting)).toMatch(/precisa de você/);
    const texto = summaryText(resumo!, 'http://localhost:4848');
    expect(texto).toContain('3 agentes · 1 trabalhando · 1 precisa de você');
    expect(texto).toContain('Precisa de você (1)');
    expect(texto).toContain('Ociosas (1)');
    expect(texto).toContain('Trabalhando (1)');
    expect(texto).not.toContain('Esta aqui');
    expect(texto).not.toContain('s-propria:x1');
    expect(texto).toContain('Esta sessão: contexto 50 k de 200 k (25%) · US$ 1,50');
  });

  it('título com ghp_ fictício chega mascarado ao texto do /escritorio', async () => {
    const corpo = (await pedir('/api/mod/summary?account=a&session=s-propria')).body;
    const texto = summaryText(parseSummary(corpo)!, 'http://localhost:4848');
    expect(texto).toContain('Subir o deploy com ');
    expect(texto).not.toContain(GHP);
    expect(texto).not.toContain('aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6');
    expect(texto).toMatch(/Subir o deploy com \S*\*\*\*/);
  });
});

describe('o caminho de cada sessão a partir do /ir do servidor', () => {
  const doServidor = async (id: string) => lerIr((await pedir(`/api/agentes/${encodeURIComponent(id)}/ir`)).body)!;
  const base4848 = { porta: 4848 };

  beforeEach(() => {
    sessao('a:1', 's-fork', { entrypoint: 'cli', kind: 'interactive' });
    sessao('a:2', 's-bg', { entrypoint: 'cli', kind: 'bg' });
    sessao('a:3', 's-fim', { entrypoint: 'cli', kind: 'interactive', cwd: '/p/minha loja' });
    office.closeMain('a:3');
    sessao('a:4', 's-app', { entrypoint: 'claude-desktop' });
  });

  it('terminal viva: Focar quando o painel foi achado e a cópia por fork rotulada; bg: attach; encerrada: cd e --resume', async () => {
    const fork = await doServidor('a:1');
    expect(acoesDaSessao({ ...base4848, superficie: 'terminal', id: 'a:1', ir: fork, focavel: true })).toEqual([
      { tipo: 'focar' },
      { tipo: 'copiar', rotulo: 'Copiar comando (cria uma cópia)', comando: 'claude --resume s-fork --fork-session', aviso: 'cria uma cópia, não responde à sessão original' },
    ]);
    const bg = await doServidor('a:2');
    expect(acoesDaSessao({ ...base4848, superficie: 'terminal', id: 'a:2', ir: bg, focavel: true })).toEqual([{ tipo: 'copiar', rotulo: 'Copiar claude attach', comando: 'claude attach s-bg' }]);
    const fim = await doServidor('a:3');
    expect(acoesDaSessao({ ...base4848, superficie: 'terminal', id: 'a:3', ir: fim, focavel: true })).toEqual([
      { tipo: 'copiar', rotulo: 'Copiar comando para retomar', comando: "cd -- '/p/minha loja' && claude --resume s-fim" },
    ]);
  });

  it('sessão do app: no terminal o claude:// da sessão; no app o link http://localhost com o nonce que o servidor aceita uma vez e redireciona para o app', async () => {
    const app = await doServidor('a:4');
    expect(acoesDaSessao({ ...base4848, superficie: 'terminal', id: 'a:4', ir: app, focavel: false })).toEqual([{ tipo: 'app', href: `claude://code/continue?session=${APP}` }]);
    const [acao] = acoesDaSessao({ porta: Number(new URL(base).port), superficie: 'desktop', id: 'a:4', ir: app, focavel: false });
    expect(acao?.tipo).toBe('app-http');
    const href = new URL((acao as { href: string }).href);
    const primeira = await pedir(`${href.pathname}${href.search}`);
    expect(primeira.status).toBe(302);
    expect(primeira.headers.location).toBe(`claude://code/continue?session=${APP}`);
    expect((await pedir(`${href.pathname}${href.search}`)).status).toBe(403);
  });
});
