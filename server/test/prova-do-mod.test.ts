// A prova do mod (mod/expediente/hooks/prova.ts, SHA-256 e HMAC em JavaScript puro) contra o `node:crypto`: se divergir em qualquer
// entrada, o servidor recusa o mod. O mod só roda pelo `claude plugin test`; aqui o mesmo arquivo roda no vitest.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { bytesParaHex, hexParaBytes, hmacSha256, provaDoCliente, provaDoServidor, sha256 } from '../../mod/expediente/hooks/prova';
import { chaveDoToken, provaDoCliente as clienteNoServidor, provaDoServidor as servidorNoServidor } from '../token';

describe('a prova do mod concorda com o node:crypto', () => {
  it('SHA-256 de entradas de 0 a 300 bytes e de algumas maiores', () => {
    for (const n of [...Array.from({ length: 301 }, (_, i) => i), 1_000, 4_096, 65_537]) {
      const dados = randomBytes(n);
      expect(bytesParaHex(sha256(dados)), String(n)).toBe(createHash('sha256').update(dados).digest('hex'));
    }
  });

  it('HMAC-SHA256 de chaves de 0 a 64 bytes e mensagens de vários tamanhos, com acento e emoji', () => {
    for (let k = 0; k <= 64; k++) {
      const chave = randomBytes(k);
      for (const mensagem of ['', 'a', 'servidor\nabc', 'ação ✓ 🏢', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'x'.repeat(1000)]) {
        expect(hmacSha256(chave, mensagem), `${k} ${mensagem.length}`).toBe(createHmac('sha256', chave).update(mensagem, 'utf8').digest('hex'));
      }
    }
  });

  it('as provas do protocolo saem iguais às do servidor para tokens, desafios, métodos e caminhos aleatórios', () => {
    for (let i = 0; i < 200; i++) {
      const token = randomBytes(32).toString('hex');
      const nonce = randomBytes(16).toString('hex');
      const caminho = `/api/${randomBytes(4).toString('hex')}/ação?x=${randomBytes(3).toString('hex')}`;
      const metodo = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'][i % 6]!;
      expect(provaDoServidor(hexParaBytes(token), nonce)).toBe(servidorNoServidor(chaveDoToken(token), nonce));
      expect(provaDoCliente(hexParaBytes(token), nonce, metodo, caminho)).toBe(clienteNoServidor(chaveDoToken(token), nonce, metodo, caminho));
    }
  });
});
