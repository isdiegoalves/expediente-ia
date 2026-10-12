// Nenhum caminho do código assina texto vindo de fora com K puro, e nenhum ramo de compatibilidade aceita prova feita com K: toda
// chamada que calcula um HMAC no servidor, no hook e no mod usa uma chave derivada por papel.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ler = (arquivo: string) => readFileSync(join(__dirname, '../..', arquivo), 'utf8');
const semComentario = (fonte: string) => fonte.split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*') && !l.trim().startsWith('/**'));

describe('K puro nunca assina', () => {
  it('server/token.ts: todo hmacHex(...) usa a chave do servidor ou a do cliente', () => {
    const chamadas = semComentario(ler('server/token.ts')).filter((l) => /hmacHex\(/.test(l) && !/const hmacHex/.test(l));
    expect(chamadas).toHaveLength(2);
    for (const l of chamadas) expect(l).toMatch(/hmacHex\(chaveDo(?:Servidor|Cliente)\(k\), /);
  });

  it('o hook: todo hmacHex(...) usa uma chave derivada, e o createHmac só aparece na definição do hmacHex', () => {
    const fonte = semComentario(ler('mod/expediente-permissoes/hooks/permission-hook.mjs'));
    const chamadas = fonte.filter((l) => /hmacHex\(/.test(l) && !/const hmacHex/.test(l));
    expect(chamadas).toHaveLength(2);
    for (const l of chamadas) expect(l).toMatch(/hmacHex\(derivar\(k, '(?:servidor|cliente)'\), /);
    expect(fonte.filter((l) => /createHmac\(/.test(l))).toHaveLength(1);
  });

  it('o mod: todo hmacSha256(...) de produção usa uma chave derivada', () => {
    const chamadas = semComentario(ler('mod/expediente/hooks/prova.ts')).filter((l) => /hmacSha256\(/.test(l) && !/export function hmacSha256/.test(l));
    expect(chamadas).toHaveLength(2);
    for (const l of chamadas) expect(l).toMatch(/hmacSha256\(chaveDo(?:Servidor|Cliente)\(k\), /);
    for (const arquivo of ['mod/expediente/hooks/register.tsx', 'mod/expediente/hooks/foco.ts']) expect(ler(arquivo)).not.toMatch(/hmacSha256\(/);
  });

  it('a página só assina o que sai de `escrever` e do stream, com a chave que recebeu; nunca importa K', () => {
    const fonte = ler('client/src/net/token.ts');
    expect((fonte.match(/subtle\.sign\(/g) ?? []).length).toBeLessThanOrEqual(2);
    expect(fonte).not.toMatch(/\.token\b/);
  });

  it('o servidor não tem ramo que aceite prova feita com K: a conferência é uma só, com a chave do cliente', () => {
    const fonte = semComentario(ler('server/http/autenticacao.ts')).join('\n');
    expect((fonte.match(/provaDoCliente\(/g) ?? []).length).toBe(1);
    expect(fonte).not.toMatch(/createHmac|hmacHex/);
  });
});
