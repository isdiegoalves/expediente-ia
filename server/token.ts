// Token local: o segredo que toda chamada que muda estado precisa apresentar (ver http/guard.ts).
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const TOKEN_ARQUIVO = 'token';
export const TOKEN_FORMATO = /^[0-9a-f]{64}$/;

export type TokenLido = { ok: true; token: string } | { ok: false; motivo: string };

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
  return { ok: true, token };
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
