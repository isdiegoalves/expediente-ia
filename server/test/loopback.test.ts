import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isLoopbackBind, loadConfig } from '../config';
import { createRequestGuard } from '../http/guard';
import { tempDir } from './fixtures';

const ROOT = resolve(__dirname, '../..');
const ler = (arquivo: string) => readFileSync(resolve(ROOT, arquivo), 'utf8');

function config(env: NodeJS.ProcessEnv, noContainer: boolean) {
  const tmp = tempDir();
  try {
    return loadConfig({ HOME: tmp.dir, ...env }, [], noContainer);
  } finally {
    tmp.cleanup();
  }
}

describe('porta só em loopback', () => {
  it('no modo nativo o servidor escuta em 127.0.0.1', () => {
    const c = config({}, false);
    expect(c.host).toBe('127.0.0.1');
    expect(c.inDocker).toBe(false);
    expect(c.terminal).toBe(true);
  });

  it('no container escuta em 0.0.0.0 e terminal, histórico e permissões ficam ligados', () => {
    const c = config({}, true);
    expect(c.host).toBe('0.0.0.0');
    expect(c.inDocker).toBe(true);
    expect(c.terminal).toBe(true);
    expect(config({ EXPEDIENTE_TERMINAL: '0' }, true).terminal).toBe(false);
  });

  it('nenhuma variável de ambiente muda o endereço de escuta', () => {
    const env = { EXPEDIENTE_HOST: '0.0.0.0', EXPEDIENTE_BIND: '0.0.0.0', EXPEDIENTE_IN_DOCKER: '1', EXPEDIENTE_ALLOWED_HOSTS: 'meu-mac.local' };
    expect(config(env, false)).toMatchObject({ host: '127.0.0.1', inDocker: false, terminal: true });
    expect(config(env, true)).toMatchObject({ host: '0.0.0.0', inDocker: true, terminal: true });
    for (const arquivo of ['server/config.ts', 'server/http/guard.ts', 'Dockerfile', 'docker-compose.yml']) {
      expect(ler(arquivo), arquivo).not.toMatch(/EXPEDIENTE_(HOST|BIND|IN_DOCKER|ALLOWED_HOSTS)/);
    }
  });

  it('o compose publica só 127.0.0.1:4848:4848, sem interpolação', () => {
    const bloco = /^\s*ports:\s*\n((?:\s+-.*\n)+)/m.exec(ler('docker-compose.yml'))?.[1] ?? '';
    expect(bloco.trim().split('\n').map((l) => l.trim())).toEqual(['- "127.0.0.1:4848:4848"']);
  });
});

describe('X-Forwarded-For', () => {
  let server: http.Server | undefined;
  afterEach(() => new Promise<void>((ok) => (server ? server.close(() => ok()) : ok())));

  async function status(xff: string): Promise<number> {
    const guard = createRequestGuard();
    server = http.createServer((req, res) => {
      if (!guard(req, res)) res.writeHead(200).end('ok');
    });
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;
    return new Promise((ok, fail) => {
      http
        .get({ host: '127.0.0.1', port, path: '/api/health', headers: { 'X-Forwarded-For': xff } }, (res) => {
          res.resume();
          ok(res.statusCode ?? 0);
        })
        .on('error', fail);
    });
  }

  it('X-Forwarded-For 192.168.0.10 leva 403; 127.0.0.1, ::1 e ::ffff:127.0.0.1 passam', async () => {
    expect(await status('192.168.0.10')).toBe(403);
    expect(await status('203.0.113.9')).toBe(403);
    expect(await status('127.0.0.1, 203.0.113.9')).toBe(403);
    expect(await status('127.0.0.1')).toBe(200);
    expect(await status('::1')).toBe(200);
    expect(await status('::ffff:127.0.0.1')).toBe(200);
    expect(await status('127.0.0.1, ::1')).toBe(200);
  });

  it('isLoopbackBind aceita ::ffff:127.x e recusa ::ffff: de fora', () => {
    expect(isLoopbackBind('::ffff:127.8.9.10')).toBe(true);
    expect(isLoopbackBind('::ffff:192.168.0.10')).toBe(false);
  });
});
