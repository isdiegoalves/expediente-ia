// A prova do token local do pré-voo (scripts/preflight.mjs, provaDoToken) contra servidores de verdade: o guard e a autenticação do
// Expediente, um impostor que não tem o token e um servidor sem a cobrança. O segredo (uma sentinela) nunca pode chegar a nenhum deles.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Autenticacao } from '../http/autenticacao';
import { createRequestGuard } from '../http/guard';
import { chaveDoToken, provaDoServidor } from '../token';

const TOKEN = '5e17e11a'.repeat(8);
const OUTRO = 'f'.repeat(64);

const { provaDoToken } = (await import(pathToFileURL(resolve(__dirname, '../../scripts/preflight.mjs')).href)) as {
  provaDoToken(base: string, chave: Buffer): Promise<{ falha?: string; prova?: Record<string, unknown> }>;
};

interface Servidor {
  base: string;
  brutos: string[];
  close(): Promise<void>;
}

/** `modo`: 'guard' = o Expediente de verdade; 'aberto' = responde o desafio direito mas não cobra prova de ninguém. */
async function servidor(token: string, modo: 'guard' | 'aberto' = 'guard'): Promise<Servidor> {
  const auth = new Autenticacao(() => ({ ok: true, token, chave: chaveDoToken(token) }));
  const guard = createRequestGuard(auth);
  const brutos: string[] = [];
  const srv = http.createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (c: Buffer) => pedacos.push(c));
    req.on('end', () => {
      brutos.push(`${req.method} ${req.url}\n${JSON.stringify(req.headers)}\n${Buffer.concat(pedacos).toString('utf8')}`);
      const url = req.url ?? '/';
      if (url.startsWith('/api/token/desafio') || modo === 'guard') {
        if (guard(req, res)) return;
      }
      if (url.startsWith('/api/token/desafio')) return void res.end();
      const [status, corpo] = url.endsWith('/decision') ? [404, '{"error":"pedido desconhecido"}'] : url === '/api/snapshot' ? [200, '{"agents":[]}'] : [200, '{"skip":"unknown-session"}'];
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(corpo);
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}`, brutos, close: () => new Promise<void>((ok) => (srv.closeAllConnections(), srv.close(() => ok()))) };
}

const abertos: Servidor[] = [];
afterEach(async () => {
  for (const s of abertos.splice(0)) await s.close();
});
const subir = async (token: string, modo?: 'guard' | 'aberto') => {
  const s = await servidor(token, modo);
  abertos.push(s);
  return s;
};

describe('provaDoToken do pré-voo', () => {
  it('Expediente de verdade: o servidor prova ter o token, escrita sem prova e com prova errada leva 401, com a prova passa, e o segredo não chega ao servidor', async () => {
    const s = await subir(TOKEN);
    const r = await provaDoToken(s.base, chaveDoToken(TOKEN));
    expect(r.falha).toBeUndefined();
    expect(r.prova).toMatchObject({ registroSem: 401, registroErrado: 401, decisaoSem: 401, decisaoErrado: 401, registroCom: 200, decisaoCom: 404 });
    expect(s.brutos.join('\n')).not.toContain(TOKEN);
    expect(s.brutos.filter((b) => b.startsWith('GET /api/token/desafio'))).toHaveLength(3);
  });

  it('impostor que não tem o token: a prova falha antes de mandar qualquer coisa (só o desafio, sem prova nem segredo)', async () => {
    const s = await subir(OUTRO);
    const r = await provaDoToken(s.base, chaveDoToken(TOKEN));
    expect(r.falha).toContain('não é o Expediente');
    expect(r.falha).not.toContain(TOKEN);
    expect(s.brutos).toHaveLength(1);
    expect(s.brutos[0]).toMatch(/^GET \/api\/token\/desafio/);
    expect(s.brutos.join('\n')).not.toContain(TOKEN);
    expect(s.brutos.join('\n').toLowerCase()).not.toContain('x-expediente-prova');
  });

  it('impostor que responde um desafio com a prova de um nonce antigo: também falha', async () => {
    const velha = provaDoServidor(chaveDoToken(TOKEN), 'a'.repeat(32));
    const srv = http.createServer((_req, res) => res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ desafio: 'b'.repeat(32), prova: velha })));
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const r = await provaDoToken(`http://127.0.0.1:${(srv.address() as AddressInfo).port}`, chaveDoToken(TOKEN));
      expect(r.falha).toContain('não é o Expediente');
    } finally {
      srv.closeAllConnections();
      srv.close();
    }
  });

  it('servidor que prova o token mas não cobra a prova nas escritas: cada escrita que passou sem prova é uma falha', async () => {
    const s = await subir(TOKEN, 'aberto');
    const r = await provaDoToken(s.base, chaveDoToken(TOKEN));
    expect(r.falha).toContain('POST /api/permissions sem a prova respondeu 200, esperado 401');
    expect(r.falha).toContain('POST da decisão com prova errada respondeu 404, esperado 401');
  });

  it('servidor fora do ar: falha dizendo que não respondeu', async () => {
    const s = await servidor(TOKEN);
    await s.close();
    const r = await provaDoToken(s.base, chaveDoToken(TOKEN));
    expect(r.falha).toContain('não respondeu ao desafio');
  });
});
