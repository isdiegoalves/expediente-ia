#!/usr/bin/env node
// Abre o escritório no navegador padrão já autorizado: lê o token local (~/.expediente/host/token) e abre
// http://localhost:<porta>/#t=<token>. O token vai no fragmento, que o navegador não manda ao servidor; a página o
// guarda e o tira da barra de endereço. O valor nunca é impresso. Porta: EXPEDIENTE_PORT (padrão 4848).
//
//   npm run abrir
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_PORT = 4848;
const TOKEN_FORMATO = /^[0-9a-f]{64}$/;

export function arquivoDoToken(home) {
  return join(home, '.expediente', 'host', 'token');
}

/** O token do arquivo, ou undefined se faltar, não puder ser lido ou não tiver 64 hexadecimais. */
export function lerToken(home) {
  try {
    const token = readFileSync(arquivoDoToken(home), 'utf8').trim();
    return TOKEN_FORMATO.test(token) ? token : undefined;
  } catch {
    return undefined;
  }
}

export function portaDe(env) {
  const n = Number.parseInt(env.EXPEDIENTE_PORT ?? '', 10);
  return Number.isInteger(n) && n > 0 && n < 65_536 ? n : DEFAULT_PORT;
}

export function urlDoEscritorio(token, porta) {
  return `http://localhost:${porta}/#t=${token}`;
}

/** O programa que abre uma URL no navegador padrão. */
export function comandoDeAbrir(plataforma = process.platform) {
  return plataforma === 'darwin' ? 'open' : 'xdg-open';
}

/**
 * Abre o escritório. `executar(comando, argv)` devolve o código de saída. Devolve o código do processo e as linhas
 * a imprimir; nenhuma delas contém o token nem a URL com ele.
 */
export function abrir({ env = process.env, home = env.HOME || homedir(), plataforma = process.platform, executar }) {
  const token = lerToken(home);
  if (!token) {
    return {
      codigo: 1,
      linhas: [
        `Não achei um token válido em ${arquivoDoToken('~')}.`,
        'Rode npm run docker:up (ele cria o token) ou suba o servidor (npm run dev ou npm start: ele cria o token se faltar) e tente de novo.',
      ],
    };
  }
  const porta = portaDe(env);
  const codigo = executar(comandoDeAbrir(plataforma), [urlDoEscritorio(token, porta)]);
  if (codigo !== 0) return { codigo: 1, linhas: [`Não consegui abrir o navegador (${comandoDeAbrir(plataforma)} saiu com ${codigo}). Abra http://localhost:${porta} e rode npm run abrir de novo.`] };
  return { codigo: 0, linhas: [`Abrindo http://localhost:${porta} no navegador padrão, já autorizado.`] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = abrir({ executar: (comando, argv) => spawnSync(comando, argv, { stdio: 'ignore' }).status ?? 1 });
  for (const l of r.linhas) console.log(l);
  process.exitCode = r.codigo;
}
