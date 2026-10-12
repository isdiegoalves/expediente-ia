import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountsService } from '../accounts/service';
import { createApiHandler } from '../http/app';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { createTerminalGate, planejarConfirmacao, PUBLICACAO_ARQUIVO } from '../publicacao';
import { tempDir, guardDeTeste } from './fixtures';

setQuiet(true);

const ID = 'a1b2c3d4e5f6'.padEnd(64, '0');
const HOSTNAME = ID.slice(0, 12);
const confirmacao = (extra: object = {}) => ({ container: ID, portas: [{ ip: '127.0.0.1', porta: 4848 }], em: '2026-10-09T12:00:00.000Z', ...extra });

function gateEm(dir: string, opts: { inDocker?: boolean; terminal?: boolean } = {}) {
  return createTerminalGate({
    terminal: opts.terminal ?? true,
    inDocker: opts.inDocker ?? true,
    file: join(dir, PUBLICACAO_ARQUIVO),
    hostname: HOSTNAME,
    ttlMs: 0,
  });
}

describe('terminal, histórico e permissões no container só com a publicação confirmada', () => {
  it('container sem confirmação: desligado, com o motivo', () => {
    const tmp = tempDir();
    try {
      const gate = gateEm(tmp.dir);
      expect(gate.on()).toBe(false);
      expect(gate.offReason()).toBe('publicação da porta não confirmada');
    } finally {
      tmp.cleanup();
    }
  });

  it('confirmação de outro container: desligado', () => {
    const tmp = tempDir();
    try {
      writeFileSync(join(tmp.dir, PUBLICACAO_ARQUIVO), JSON.stringify(confirmacao({ container: 'f'.repeat(64) })));
      expect(gateEm(tmp.dir).on()).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });

  it('confirmação com 0.0.0.0, com uma porta fora do loopback, vazia ou ilegível: desligado', () => {
    const tmp = tempDir();
    try {
      const gate = gateEm(tmp.dir);
      const grava = (conteudo: string) => writeFileSync(join(tmp.dir, PUBLICACAO_ARQUIVO), conteudo);
      grava(JSON.stringify(confirmacao({ portas: [{ ip: '0.0.0.0', porta: 4848 }] })));
      expect(gate.on()).toBe(false);
      grava(JSON.stringify(confirmacao({ portas: [{ ip: '127.0.0.1', porta: 4848 }, { ip: '192.168.0.10', porta: 4848 }] })));
      expect(gate.on()).toBe(false);
      grava(JSON.stringify(confirmacao({ portas: [] })));
      expect(gate.on()).toBe(false);
      grava('{ cortado');
      expect(gate.on()).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });

  it('confirmação válida: ligado, e liga sozinho quando o arquivo aparece', () => {
    const tmp = tempDir();
    try {
      const gate = gateEm(tmp.dir);
      expect(gate.on()).toBe(false);
      writeFileSync(join(tmp.dir, PUBLICACAO_ARQUIVO), JSON.stringify(confirmacao()));
      expect(gate.on()).toBe(true);
      expect(gate.offReason()).toBeUndefined();
    } finally {
      tmp.cleanup();
    }
  });

  it('nativo: ligado sem arquivo nenhum', () => {
    const tmp = tempDir();
    try {
      expect(gateEm(tmp.dir, { inDocker: false }).on()).toBe(true);
    } finally {
      tmp.cleanup();
    }
  });

  it('EXPEDIENTE_TERMINAL=0 desliga mesmo com a confirmação válida', () => {
    const tmp = tempDir();
    try {
      writeFileSync(join(tmp.dir, PUBLICACAO_ARQUIVO), JSON.stringify(confirmacao()));
      expect(gateEm(tmp.dir, { terminal: false }).on()).toBe(false);
      expect(gateEm(tmp.dir, { terminal: false, inDocker: false }).on()).toBe(false);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('rotas atrás da trava da publicação', () => {
  let server: http.Server | undefined;
  afterEach(() => new Promise<void>((ok) => (server ? server.close(() => ok()) : ok())));

  async function status(dir: string, method: string, path: string): Promise<number> {
    const tmp = tempDir();
    const accounts = new AccountsService({ dirs: [], home: tmp.dir, env: {}, onChange: () => {} });
    const gate = gateEm(dir);
    const office = new Office({ names: new NameStore(null), version: 't', startedAt: Date.now(), accounts: (s) => accounts.list(s), sources: () => [], accountName: () => undefined, terminal: gate.on });
    const hub = new Hub(office, { throttleMs: 10 });
    const api = createApiHandler({
      office,
      hub,
      accounts,
      sources: () => [],
      version: 't',
      inDocker: true,
      terminal: gate.on,
      terminals: { attach: (_req: unknown, res: http.ServerResponse) => res.writeHead(200).end('ok') } as never,
      permissions: (_req, res) => {
        res.writeHead(201).end('{}');
      },
    });
    const guard = guardDeTeste();
    server = http.createServer((req, res) => {
      if (guard(req, res)) return;
      if (!api(req, res, new URL(req.url ?? '/', 'http://x'))) res.writeHead(404).end();
    });
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok));
    const port = (server.address() as AddressInfo).port;
    try {
      return await new Promise((ok, fail) => {
        const req = http.request({ host: '127.0.0.1', port, method, path, headers: { 'Content-Type': 'application/json' } }, (res) => {
          res.resume();
          ok(res.statusCode ?? 0);
        });
        req.on('error', fail);
        req.end(method === 'POST' ? '{}' : undefined);
      });
    } finally {
      hub.stop();
      tmp.cleanup();
    }
  }

  it('sem confirmação, GET do terminal e POST /api/permissions respondem desligado (403)', async () => {
    const tmp = tempDir();
    try {
      expect(await status(tmp.dir, 'GET', '/api/agents/x/terminal')).toBe(403);
      await new Promise<void>((ok) => server!.close(() => ok()));
      expect(await status(tmp.dir, 'POST', '/api/permissions')).toBe(403);
    } finally {
      tmp.cleanup();
    }
  });

  it('com a confirmação válida, as duas rotas atendem', async () => {
    const tmp = tempDir();
    try {
      writeFileSync(join(tmp.dir, PUBLICACAO_ARQUIVO), JSON.stringify(confirmacao()));
      expect(await status(tmp.dir, 'GET', '/api/agents/x/terminal')).toBe(200);
      await new Promise<void>((ok) => server!.close(() => ok()));
      expect(await status(tmp.dir, 'POST', '/api/permissions')).toBe(201);
    } finally {
      tmp.cleanup();
    }
  });
});

describe('confirmação gravada pelo docker-up', () => {
  const inspect = (ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null | undefined>) => ({ Id: ID, NetworkSettings: { Ports: ports } });

  it('toda porta em 127.0.0.1: confirma com o id, as portas e a hora', () => {
    const r = planejarConfirmacao(inspect({ '4848/tcp': [{ HostIp: '127.0.0.1', HostPort: '4848' }] }), new Date('2026-10-09T12:00:00Z'));
    expect(r).toEqual({ publicacao: { container: ID, portas: [{ ip: '127.0.0.1', porta: 4848 }], em: '2026-10-09T12:00:00.000Z' } });
  });

  it('porta em 0.0.0.0, sem IP, ao lado de uma em 127.0.0.1 ou nenhuma publicada: recusa', () => {
    for (const ports of [
      { '4848/tcp': [{ HostIp: '0.0.0.0', HostPort: '4848' }] },
      { '4848/tcp': [{ HostIp: '', HostPort: '4848' }] },
      { '4848/tcp': [{ HostIp: '127.0.0.1', HostPort: '4848' }, { HostIp: '::', HostPort: '4848' }] },
      { '4848/tcp': null },
      {},
    ]) {
      expect(planejarConfirmacao(inspect(ports)), JSON.stringify(ports)).toHaveProperty('motivo');
    }
  });
});
