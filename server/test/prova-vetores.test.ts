// Os mesmos vetores em toda implementação da prova (servidor, hook e scripts em Node; a página e o mod têm os seus testes com os
// mesmos números). Os valores foram conferidos com `openssl dgst -sha256 -mac HMAC -macopt hexkey:...`.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { chaveDoToken, iguais, provaDoCliente, provaDoServidor } from '../token';

const TOKEN = '5e17e11a'.repeat(8);
const NONCE = '0123456789abcdef0123456789abcdef';
const DESAFIO = 'fedcba9876543210fedcba9876543210';
const SERVIDOR = 'd52bafb794934f32c57a85d84641389f3166e34912e92860d15080b3872d3739';
const CLIENTE_POST = '58746d354a58f1b4d8641b70553f441c3364a53c3b4d95fd4fa44b05636aa4f4';
const CLIENTE_GET = '00f3d2544e984b408048a3627db28b1f6af846ca195470a19d1e8bf08652da9b';
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
