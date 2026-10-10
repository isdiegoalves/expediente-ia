// O resumo "desde que você saiu" ponta a ponta: a presença das abas, a saída gravada que sobrevive a um servidor novo,
// as contagens e a última tarefa de GET /api/resumo, a máscara de segredos e o texto do /escritorio resumo.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseResumo, resumoTexto } from '../../mod/expediente/hooks/resumo';
import { AccountsService } from '../accounts/service';
import { Presenca } from '../history/resumo';
import { createApiHandler } from '../http/app';
import { createRequestGuard } from '../http/guard';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { tempDir } from './fixtures';

setQuiet(true);

const GHP = `ghp_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6'}`;
const STATS = { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 };
const T0 = 1_700_000_000_000;

let relogio = T0;
let dir: string;
let cleanup: () => void;
let office: Office;
let servidor: http.Server | undefined;
let base: string;

async function subir(presenca: Presenca): Promise<void> {
  await descer();
  const accounts = new AccountsService({ dirs: [], home: dir, env: {}, onChange: () => undefined });
  const hub = new Hub(office, { throttleMs: 10 });
  hub.start();
  const api = createApiHandler({ office, hub, accounts, sources: () => [], version: 't', inDocker: false, resumo: { presenca, inicio: T0 - 1_000 }, now: () => relogio });
  const guard = createRequestGuard();
  servidor = http.createServer((req, res) => {
    if (guard(req, res)) return;
    api(req, res, new URL(req.url ?? '/', 'http://x'));
  });
  await new Promise<void>((ok) => servidor!.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
}

async function descer(): Promise<void> {
  if (!servidor) return;
  servidor.closeAllConnections();
  await new Promise((ok) => servidor!.close(ok));
  servidor = undefined;
}

function pedir(path: string, init: { method?: string; body?: unknown; host?: string } = {}): Promise<{ status: number; json: any }> {
  const u = new URL(base);
  const corpo = init.body !== undefined ? JSON.stringify(init.body) : undefined;
  return new Promise((ok, fail) => {
    const req = http.request(
      { host: u.hostname, port: u.port, path, method: init.method ?? 'GET', headers: { ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(init.host ? { Host: init.host } : {}) } },
      (res) => {
        let texto = '';
        res.setEncoding('utf8');
        res.on('data', (c: string) => (texto += c));
        res.on('end', () => ok({ status: res.statusCode ?? 0, json: texto ? JSON.parse(texto) : null }));
      },
    );
    req.on('error', fail);
    req.end(corpo);
  });
}

const presenca = (aba: string, visivel: boolean) => pedir('/api/resumo/presenca', { method: 'POST', body: { aba, visivel } });

beforeEach(() => {
  const t = tempDir();
  dir = t.dir;
  cleanup = t.cleanup;
  relogio = T0;
  office = new Office({ names: new NameStore(null), version: 't', startedAt: 0, accounts: () => [], sources: () => [], accountName: () => undefined, now: () => relogio });
  office.addMain({ id: 'a:1', account: 'a', sessionId: 's1', cwd: '/p/loja', role: 'Agente principal', startedAt: 1, status: 'working' });
  office.addMain({ id: 'a:2', account: 'a', sessionId: 's2', cwd: '/p/loja', role: 'Agente principal', startedAt: 1, status: 'working' });
  office.addMain({ id: 'a:3', account: 'a', sessionId: 's3', cwd: '/p/site', role: 'Agente principal', startedAt: 1, status: 'working' });
  office.addMain({ id: 'a:4', account: 'a', sessionId: 's4', cwd: '/p/api', role: 'Agente principal', startedAt: 1, status: 'working' });
  office.applyTranscript('a:1', { title: 'Migrar o banco', tasks: [{ id: 't1', title: 'Escrever testes', status: 'in_progress', activeForm: 'Escrevendo testes' }], stats: STATS });
  office.applyTranscript('a:2', { title: `Deploy com ${GHP}`, tasks: [{ id: 't1', title: `Chamar API com ${GHP}`, status: 'in_progress' }], stats: STATS });
  office.applyTranscript('a:4', { title: 'Revisar o PR', tasks: [], stats: STATS });
  office.addSub({ id: 's4:x', parentId: 'a:4', sessionId: 's4', role: 'Explore', agentName: 'revisor', background: true, startedAt: 1 });
});

afterEach(async () => {
  await descer();
  cleanup();
});

describe('saída e volta', () => {
  it('a saída gravada sobrevive a um servidor novo e a volta depois de 2 h abre o resumo uma vez só', async () => {
    const arquivo = join(dir, 'resumo.json');
    await subir(new Presenca(arquivo, () => relogio));
    expect((await presenca('aba1', true)).json).toEqual({ saiuEm: null, mostrar: false });
    relogio += 1_000;
    const saiu = relogio;
    expect((await presenca('aba1', false)).json).toMatchObject({ saiuEm: saiu });

    relogio += 2 * 3_600_000;
    const reiniciado = new Presenca(arquivo, () => relogio);
    reiniciado.load();
    await subir(reiniciado);
    expect((await presenca('aba2', true)).json).toEqual({ saiuEm: saiu, mostrar: true });
    expect((await presenca('aba2', true)).json).toEqual({ saiuEm: saiu, mostrar: false });
  });

  it('só pelo próprio computador, só POST na presença e corpo no formato', async () => {
    await subir(new Presenca(null, () => relogio));
    expect((await pedir('/api/resumo', { host: '192.168.0.9:4848' })).status).toBe(403);
    expect((await presenca('x', true)).status).toBe(200);
    expect((await pedir('/api/resumo/presenca', { method: 'POST', body: { aba: 'x', visivel: true }, host: '192.168.0.9:4848' })).status).toBe(403);
    expect((await pedir('/api/resumo/presenca')).status).toBe(405);
    expect((await pedir('/api/resumo', { method: 'POST', body: {} })).status).toBe(405);
    expect((await pedir('/api/resumo/presenca', { method: 'POST', body: { aba: 'x' } })).status).toBe(400);
    expect((await pedir('/api/resumo/presenca', { method: 'POST', body: { aba: 'a b/c', visivel: true } })).status).toBe(400);
  });
});

describe('GET /api/resumo', () => {
  async function voltarDepoisDeDuasHoras(): Promise<void> {
    await subir(new Presenca(join(dir, 'resumo.json'), () => relogio));
    await presenca('aba1', true);
    await presenca('aba1', false);
    relogio += 2 * 3_600_000;
    office.setStatus('a:2', 'idle');
    office.setStatus('a:3', 'waiting', 'aprovar uma permissão');
    office.markStalled('s4:x', { desde: relogio - 60_000, erro: 'API 529: sobrecarregada' });
  }

  it('2 h fora: quantas terminaram, quais travaram com o motivo, quais esperam e a última tarefa de cada uma', async () => {
    await voltarDepoisDeDuasHoras();
    const { status, json } = await pedir('/api/resumo');
    expect(status).toBe(200);
    expect(json).toMatchObject({ desde: T0, terminaram: 1, travaram: 1, esperam: 1, trabalhando: 1 });
    const por = (id: string) => json.sessoes.find((s: { id: string }) => s.id === id);
    expect(por('a:3')).toMatchObject({ estado: 'espera', motivo: 'aprovar uma permissão', sala: 'site' });
    expect(por('a:4')).toMatchObject({ estado: 'travou', motivo: 'revisor: API 529: sobrecarregada' });
    expect(por('a:2').estado).toBe('terminou');
    expect(por('a:1')).toMatchObject({ estado: 'trabalhando', tarefa: { rotulo: 'Em andamento', texto: 'Escrevendo testes' } });
    expect(por('a:4').tarefa).toEqual({ rotulo: 'Último pedido', texto: 'Revisar o PR' });
    expect(json.sessoes.map((s: { id: string }) => s.id)).toEqual(['a:3', 'a:4', 'a:2', 'a:1']);
  });

  it('segredo no título e na tarefa chega mascarado', async () => {
    await voltarDepoisDeDuasHoras();
    const corpo = JSON.stringify((await pedir('/api/resumo')).json);
    expect(corpo).toContain('Chamar API com');
    expect(corpo).not.toContain(GHP);
    expect(corpo).not.toContain('aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6');
  });

  it('com ?session= e ?account= a sessão de quem pergunta fica de fora', async () => {
    await voltarDepoisDeDuasHoras();
    const { json } = await pedir('/api/resumo?account=a&session=s3');
    expect(json.esperam).toBe(0);
    expect(json.sessoes.map((s: { id: string }) => s.id)).not.toContain('a:3');
  });

  it('sem saída conhecida, conta desde que o servidor subiu', async () => {
    await subir(new Presenca(null, () => relogio));
    expect((await pedir('/api/resumo')).json.desde).toBe(T0 - 1_000);
  });

  it('o texto do /escritorio resumo traz as contagens, o motivo e a tarefa, sem o segredo', async () => {
    await voltarDepoisDeDuasHoras();
    const resumo = parseResumo(JSON.stringify((await pedir('/api/resumo')).json));
    const texto = resumoTexto(resumo!, 'http://localhost:4848');
    expect(texto).toContain('1 terminou · 1 travou · 1 espera você · 1 trabalhando');
    expect(texto).toContain('Esperam você (1)');
    expect(texto).toContain('Travaram (1)');
    expect(texto).toContain('revisor: API 529: sobrecarregada');
    expect(texto).toContain('Em andamento: Escrevendo testes');
    expect(texto).toContain('há 2 h');
    expect(texto).not.toContain(GHP);
    expect(texto).not.toContain('aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6');
  });
});
