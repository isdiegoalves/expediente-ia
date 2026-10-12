// Os mesmos vetores em toda implementação da prova (servidor, hook e scripts em Node; a página e o mod têm os seus testes com os
// mesmos números). Os valores foram conferidos com `openssl dgst -sha256 -mac HMAC -macopt hexkey:...`.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chaveDoToken, iguais, provaDoCliente, provaDoServidor } from '../token';

const TOKEN = '5e17e11a'.repeat(8);
const NONCE = '0123456789abcdef0123456789abcdef';
const DESAFIO = 'fedcba9876543210fedcba9876543210';
const SERVIDOR = '2bd2a945624115ad28aacc2465d4ed89a3135ae6f58c4e73e687f5d75ab8e4a3';
const CLIENTE_POST = '2475edeaa311b39075668ed854cbc3fd23334b904640120a3925f072b6e1be94';
const CLIENTE_GET = '0d34a7211a64c5d2442a77242f4a59e5ada5ae83435d9f2795627537273f7385';
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
