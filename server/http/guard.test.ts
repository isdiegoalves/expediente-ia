import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { TokenLido } from '../token';
import { createRequestGuard } from './guard';

const TOKEN = 'c0ffee'.repeat(10) + 'abcd';

let server: http.Server;
let port: number;
let token: TokenLido = { ok: true, token: TOKEN };
let chegaram = 0;

beforeAll(async () => {
  const guard = createRequestGuard(() => token);
  server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    chegaram++;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

function enviar(method: string, path: string, headers: Record<string, string>): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (c: string) => (body += c));
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    // O cliente do Node só põe corpo com tamanho declarado nestes métodos.
    req.end(['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined);
  });
}

/** Com o token certo, a menos que o teste mande outro cabeçalho (ou `X-Expediente-Token` próprio). */
function send(method: string, path: string, headers: Record<string, string> = {}) {
  return enviar(method, path, { 'X-Expediente-Token': TOKEN, ...headers });
}

const JSON_CT = { 'Content-Type': 'application/json' };

describe('guard de Host/Origin', () => {
  it('Host evil.example leva 403', async () => {
    expect((await send('GET', '/api/health', { Host: 'evil.example' })).status).toBe(403);
    expect((await send('GET', '/api/health')).status).toBe(200);
  });

  it('POST sem JSON leva 415', async () => {
    expect((await send('POST', '/api/demo', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await send('POST', '/api/demo')).status).toBe(415);
    expect((await send('POST', '/api/demo', JSON_CT)).status).toBe(200);
  });

  it('POST com Origin http://habblaud.localhost:1355 leva 403', async () => {
    const host = `127.0.0.1:${port}`;
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: 'http://habblaud.localhost:1355' })).status).toBe(403);
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: 'http://localhost:5173', Host: host })).status).toBe(403);
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: `http://${host}` })).status).toBe(200);
  });

  it('nenhuma rota responde Access-Control-*', async () => {
    const respostas = [
      await send('GET', '/api/health', { Origin: 'https://evil.example' }),
      await send('OPTIONS', '/api/demo', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }),
      await send('POST', '/api/demo', { ...JSON_CT, Origin: 'https://evil.example' }),
      await send('GET', '/api/health', { Host: 'evil.example' }),
    ];
    for (const r of respostas) expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
});

const ROTAS_DE_ESCRITA = [
  '/api/permissions',
  '/api/permissions/p1/decision',
  `/api/mod/focos/${'a'.repeat(32)}/assumir`,
  `/api/mod/focos/${'a'.repeat(32)}/resultado`,
  '/api/agentes/x/focar',
  '/api/agents/x/character',
  '/api/rooms/rename',
  '/api/social/ritmo',
  '/api/demo',
  '/api/resumo/presenca',
  '/api/agents/x/terminal',
  '/api',
];
const METODOS_DE_ESCRITA = ['POST', 'PUT', 'DELETE', 'PATCH'];

describe('token local', () => {
  beforeEach(() => {
    token = { ok: true, token: TOKEN };
    chegaram = 0;
  });

  it('todo método de escrita em toda rota de escrita leva 401 sem cabeçalho, vazio, errado ou de outro tamanho, e nada chega à rota', async () => {
    const semCabecalho = (m: string, p: string) => enviar(m, p, JSON_CT);
    const variantes: Array<(m: string, p: string) => ReturnType<typeof enviar>> = [
      semCabecalho,
      (m, p) => enviar(m, p, { ...JSON_CT, 'X-Expediente-Token': '' }),
      (m, p) => enviar(m, p, { ...JSON_CT, 'X-Expediente-Token': `${TOKEN.slice(0, -1)}0` }),
      (m, p) => enviar(m, p, { ...JSON_CT, 'X-Expediente-Token': TOKEN.slice(0, 63) }),
      (m, p) => enviar(m, p, { ...JSON_CT, 'X-Expediente-Token': `${TOKEN}0` }),
      (m, p) => enviar(m, p, { ...JSON_CT, 'X-Expediente-Token': TOKEN.toUpperCase() }),
      (m, p) => enviar(m, p, { ...JSON_CT, 'X-Expediente-Token': `${TOKEN}, ${TOKEN}` }),
    ];
    for (const m of METODOS_DE_ESCRITA) {
      for (const p of ROTAS_DE_ESCRITA) {
        for (const v of variantes) {
          const r = await v(m, p);
          expect(r.status, `${m} ${p}`).toBe(401);
          expect(r.headers['content-type']).toMatch(/^application\/json/);
          expect(JSON.parse(r.body).error).toMatch(/token/i);
          expect(r.body).not.toContain(TOKEN);
        }
      }
    }
    expect(chegaram).toBe(0);
  });

  it('com o valor certo a escrita passa, em todas as rotas e métodos', async () => {
    for (const m of METODOS_DE_ESCRITA) for (const p of ROTAS_DE_ESCRITA) expect((await send(m, p, JSON_CT)).status, `${m} ${p}`).toBe(200);
    expect(chegaram).toBe(METODOS_DE_ESCRITA.length * ROTAS_DE_ESCRITA.length);
  });

  it('o token é cobrado antes do Content-Type: pedido forjado sem os dois leva 401, não 415', async () => {
    expect((await enviar('POST', '/api/demo', {})).status).toBe(401);
    expect((await send('POST', '/api/demo', { 'Content-Type': 'text/plain' })).status).toBe(415);
  });

  it('caminho com segmentos .. ou %2e que a rota lê como /api/ também é cobrado', async () => {
    for (const p of ['/x/../api/demo', '/x/%2e%2e/api/permissions', '/./api/demo', '/api/./demo']) {
      expect((await enviar('POST', p, JSON_CT)).status, p).toBe(401);
    }
  });

  it('OPTIONS em /api/ também exige o token; fora de /api/ nada é cobrado', async () => {
    expect((await enviar('OPTIONS', '/api/demo', {})).status).toBe(401);
    expect((await send('OPTIONS', '/api/demo')).status).toBe(200);
    expect((await enviar('POST', '/fora/da/api', JSON_CT)).status).toBe(200);
  });

  it('GET e HEAD não mudam: passam sem cabeçalho e com cabeçalho errado', async () => {
    for (const m of ['GET', 'HEAD']) {
      expect((await enviar(m, '/api/snapshot', {})).status).toBe(200);
      expect((await enviar(m, '/api/permissions/p1/wait', { 'X-Expediente-Token': 'errado' })).status).toBe(200);
    }
  });

  it('Origin de fora continua levando 403, mesmo com o token certo', async () => {
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: 'https://evil.example' })).status).toBe(403);
  });

  it('servidor sem token legível recusa toda escrita (503), mesmo com um cabeçalho que pareça certo, e a leitura segue', async () => {
    token = { ok: false, motivo: 'o arquivo do token não existe ou não pode ser lido' };
    for (const m of METODOS_DE_ESCRITA) {
      for (const cab of [TOKEN, '', 'x']) {
        const r = await enviar(m, '/api/permissions/p1/decision', { ...JSON_CT, 'X-Expediente-Token': cab });
        expect(r.status, m).toBe(503);
        expect(JSON.parse(r.body).error).toContain('o arquivo do token não existe');
      }
    }
    expect((await enviar('POST', '/api/demo', JSON_CT)).status).toBe(503);
    expect((await enviar('GET', '/api/health', {})).status).toBe(200);
    expect(chegaram).toBe(1);
  });

  it('o arquivo é relido a cada escrita: o token novo vale e o antigo deixa de valer sem reiniciar', async () => {
    const novo = 'f'.repeat(64);
    token = { ok: true, token: novo };
    expect((await send('POST', '/api/demo', JSON_CT)).status).toBe(401);
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Token': novo })).status).toBe(200);
  });
});
