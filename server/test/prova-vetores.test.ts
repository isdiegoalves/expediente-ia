// Os mesmos vetores em toda implementação da prova (servidor, hook e scripts em Node; a página e o mod têm os seus testes com os
// mesmos números). Os valores foram conferidos com `openssl dgst -sha256 -mac HMAC -macopt hexkey:...`.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { chaveDoCliente, chaveDoServidor, chaveDoToken, iguais, provaDoCliente, provaDoServidor } from '../token';

const TOKEN = '5e17e11a'.repeat(8);
const NONCE = '0123456789abcdef0123456789abcdef';
const DESAFIO = 'fedcba9876543210fedcba9876543210';
const SERVIDOR = 'cbdfad1b9f8b06d8dcfdc5fb64d511fedb458c3af9aa91777ecfa67998ab50a8';
const CLIENTE_POST = '186816cb2fb8ea208d90176df76ed2b6053c76390b48f55a0a804453b0c3418e';
const CLIENTE_GET = '95e5599e827f86562e2d79ad4e555e8cb9360c958b29da16b7a982ffd05a666a';
const CAMINHO = '/api/permissions/p-1/decision?x=1';

const hook = (await import(pathToFileURL(resolve(__dirname, '../../mod/expediente-permissoes/hooks/permission-hook.mjs')).href)) as {
  serverProof(chave: Buffer, nonce: string): string;
  clientProof(chave: Buffer, desafio: string, metodo: string, caminho: string): string;
  sameHex(a: string, b: string): boolean;
};

describe('vetores da prova do token', () => {
  const chave = chaveDoToken(TOKEN);

  it('servidor (server/token.ts)', () => {
    expect(provaDoServidor(chave, NONCE)).toBe(SERVIDOR);
    expect(provaDoCliente(chave, DESAFIO, 'POST', CAMINHO)).toBe(CLIENTE_POST);
    expect(provaDoCliente(chave, DESAFIO, 'GET', '/api/mod/focos')).toBe(CLIENTE_GET);
  });

  it('as chaves por papel: o vetor da derivação (conferido com openssl), igual no servidor, no hook e no mod', () => {
    expect(chaveDoCliente(chave).toString('hex')).toBe('a69dc70bd79ca70a947af7c6984ae0f2e4dc1604dcb5b97ef9fca5374600e78c');
    expect(chaveDoServidor(chave).toString('hex')).toBe('7aa2f20fdfb2e6b8a5908f9dfa61cd70a55f39998fe757c58eab2046163b297f');
    // O hook e o mod derivam por dentro: as provas deles sobre as mesmas chaves são os vetores abaixo.
    expect(hook.serverProof(chave, NONCE)).toBe(SERVIDOR);
  });

  it('nenhuma chave derivada é HMAC(K, x), para os rótulos e para os formatos de mensagem que o protocolo assina (uma chave que só assina com K não as calcula)', () => {
    const textos = ['expediente/cliente', 'expediente/servidor', 'expediente/cliente\n', 'expediente/servidor\n', 'cliente', 'servidor', '', `servidor\n${NONCE}`, `cliente\n${DESAFIO}\nPOST\n${CAMINHO}`, `cliente\n${DESAFIO}\nGET\n/api/mod/focos`, `cliente\n${NONCE}\nGET\n/api/stream`];
    for (const x of textos) {
      const hmac = createHmac('sha256', chave).update(x).digest('hex');
      expect(hmac, x).not.toBe(chaveDoCliente(chave).toString('hex'));
      expect(hmac, x).not.toBe(chaveDoServidor(chave).toString('hex'));
    }
    expect(chaveDoCliente(chave).equals(chaveDoServidor(chave))).toBe(false);
  });

  it('hook (permission-hook.mjs), que os scripts também usam', () => {
    expect(hook.serverProof(chave, NONCE)).toBe(SERVIDOR);
    expect(hook.clientProof(chave, DESAFIO, 'POST', CAMINHO)).toBe(CLIENTE_POST);
    expect(hook.clientProof(chave, DESAFIO, 'GET', '/api/mod/focos')).toBe(CLIENTE_GET);
  });

  it('os prefixos "servidor" e "cliente" separam as provas, e método e caminho entram na conta', () => {
    expect(provaDoCliente(chave, NONCE, 'POST', '')).not.toBe(provaDoServidor(chave, NONCE));
    expect(provaDoCliente(chave, DESAFIO, 'PUT', CAMINHO)).not.toBe(CLIENTE_POST);
    expect(provaDoCliente(chave, DESAFIO, 'POST', `${CAMINHO}&y=2`)).not.toBe(CLIENTE_POST);
    expect(provaDoCliente(chave, DESAFIO, 'post', CAMINHO)).not.toBe(CLIENTE_POST);
  });

  it('a comparação em tempo constante aceita só texto igual, de qualquer tamanho', () => {
    for (const [a, b, esperado] of [['abc', 'abc', true], ['abc', 'abd', false], ['abc', 'abcd', false], ['', 'a', false], ['', '', true]] as const) {
      expect(iguais(a, b)).toBe(esperado);
      expect(hook.sameHex(a, b)).toBe(esperado);
    }
  });
});
