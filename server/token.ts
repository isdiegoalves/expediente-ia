// Token local: o segredo que prova quem pode mudar estado (ver http/guard.ts). Ele nunca sai em claro: quem escreve
// prova que o conhece com um HMAC-SHA256, e o servidor prova o mesmo de volta antes de o cliente confiar nele.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const TOKEN_ARQUIVO = 'token';
export const TOKEN_FORMATO = /^[0-9a-f]{64}$/;

export type TokenLido = { ok: true; token: string; chave: Buffer } | { ok: false; motivo: string };

export const arquivoDoToken = (hostDir: string): string => join(hostDir, TOKEN_ARQUIVO);

/** Lê o token do arquivo a cada chamada: criar ou trocar o arquivo vale sem reiniciar o servidor. */
export function lerToken(arquivo: string): TokenLido {
  let texto: string;
  try {
    texto = readFileSync(arquivo, 'utf8');
  } catch {
    return { ok: false, motivo: 'o arquivo do token não existe ou não pode ser lido' };
  }
  const token = texto.trim();
  if (!TOKEN_FORMATO.test(token)) return { ok: false, motivo: 'o arquivo do token não tem 64 caracteres hexadecimais' };
  return { ok: true, token, chave: chaveDoToken(token) };
}

/** Cria o arquivo (modo 600) com 32 bytes aleatórios em hexadecimal se ele não existir; nunca sobrescreve. Devolve true se criou. */
export function garantirToken(arquivo: string): boolean {
  mkdirSync(dirname(arquivo), { recursive: true, mode: 0o700 });
  try {
    writeFileSync(arquivo, `${randomBytes(32).toString('hex')}\n`, { flag: 'wx', mode: 0o600 });
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw err;
  }
}

/** O desafio e o nonce do cliente: 16 bytes aleatórios em hexadecimal. */
export const NONCE_FORMATO = /^[0-9a-f]{32}$/;

/** A chave dos HMAC: os 32 bytes que o token escreve em hexadecimal. */
export const chaveDoToken = (token: string): Buffer => Buffer.from(token, 'hex');

export const aleatorioHex = (): string => randomBytes(16).toString('hex');

const hmacHex = (chave: Buffer, mensagem: string): string => createHmac('sha256', chave).update(mensagem, 'utf8').digest('hex');

/**
 * SHA-256 sobre o rótulo e K, e não um HMAC com K: uma chave que "só assina HMAC com K" (a do desenho anterior, que a página
 * guardava) não calcula a derivação, então a separação dos papéis vale por construção. K puro nunca assina texto de fora.
 */
const derivar = (k: Buffer, papel: 'cliente' | 'servidor'): Buffer => createHash('sha256').update(`expediente/${papel}\n`).update(k).digest();

/**
 * Duas chaves derivadas de K, uma por papel. K nunca vai ao navegador: a página recebe só a do cliente, que assina provas de cliente e
 * não consegue produzir a prova do servidor. Com uma chave só, uma página falsa servida na porta (com o Expediente parado) pediria à
 * chave guardada no navegador a assinatura de `servidor\n<nonce>` e passaria na conferência que o hook, o mod e o abrir fazem.
 */
export const chaveDoCliente = (k: Buffer): Buffer => derivar(k, 'cliente');
export const chaveDoServidor = (k: Buffer): Buffer => derivar(k, 'servidor');

/** O que o servidor responde ao nonce do cliente: só quem tem K sabe (a chave do servidor, derivada de K). */
export const provaDoServidor = (k: Buffer, nonce: string): string => hmacHex(chaveDoServidor(k), `servidor\n${nonce}`);

/** O que o cliente manda numa chamada: preso ao desafio, ao método e ao caminho com a consulta, como o servidor os lê. Assina com a chave do cliente. */
export const provaDoCliente = (k: Buffer, desafio: string, metodo: string, caminho: string): string => hmacHex(chaveDoCliente(k), `cliente\n${desafio}\n${metodo}\n${caminho}`);

/** Compara os resumos SHA-256: `timingSafeEqual` lança com tamanhos diferentes, e assim o tamanho também não vaza. */
export function iguais(a: string, b: string): boolean {
  const resumo = (v: string) => createHash('sha256').update(v).digest();
  return timingSafeEqual(resumo(a), resumo(b));
}
