import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequestGuard } from './guard';

let server: http.Server;
let port: number;

beforeAll(async () => {
  const guard = createRequestGuard();
  server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{}');
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

function send(method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((ok, fail) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      ok({ status: res.statusCode ?? 0, headers: res.headers });
    });
    req.on('error', fail);
    req.end(method === 'POST' ? '{}' : undefined);
  });
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
