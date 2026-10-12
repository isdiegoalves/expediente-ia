#!/usr/bin/env node
// Abre o escritório no navegador padrão já autorizado, sem que o token (o segredo de ~/.expediente/host/token) saia do computador
// nem apareça em lugar nenhum:
//   1. confere que quem responde em http://127.0.0.1:<porta> tem o seu token (a prova do servidor); senão não abre nada;
//   2. pede ao servidor um bilhete de uso único (60 s), provando que conhece o token;
//   3. grava, numa pasta temporária de modo 700, um HTML que redireciona a http://127.0.0.1:<porta>/#b=<bilhete> e abre esse
//      arquivo: o argv do `open` leva só o caminho (outro usuário lê o argv com `ps`, não a pasta). A página troca o bilhete pela
//      chave do token e tira o fragmento da barra de endereço.
// O endereço é sempre o IP literal, o mesmo em que a prova foi conferida: `localhost` pode resolver para ::1, onde outro programa
// ouça a mesma porta. Porta: EXPEDIENTE_PORT (padrão 4848).
//
//   npm run abrir
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchComProva, readSecret } from '../mod/expediente-permissoes/hooks/permission-hook.mjs';

export const DEFAULT_PORT = 4848;
/** Quanto vale o bilhete no servidor; a pasta temporária some junto. */
export const BILHETE_MS = 60_000;
const BILHETE_FORMATO = /^[0-9a-f]{32}$/;

export function portaDe(env) {
  const n = Number.parseInt(env.EXPEDIENTE_PORT ?? '', 10);
  return Number.isInteger(n) && n > 0 && n < 65_536 ? n : DEFAULT_PORT;
}

export function urlDoEscritorio(bilhete, porta) {
  return `http://127.0.0.1:${porta}/#b=${bilhete}`;
}

/** O HTML que leva o navegador ao escritório (a URL é só IP literal, porta e 32 hexadecimais: não precisa de escape). */
export function htmlDoEscritorio(url) {
  return `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0;url=${url}">\n<title>Expediente</title>\n<a href="${url}">Abrir o escritório</a>\n`;
}

/** O programa que abre um arquivo no navegador padrão. */
export function comandoDeAbrir(plataforma = process.platform) {
  return plataforma === 'darwin' ? 'open' : 'xdg-open';
}

/** Apaga a pasta quando o bilhete vence, ou antes, se ela já sumiu. Um processo à parte: o `npm run abrir` não espera. */
export function iniciarLimpeza(pasta, ms = BILHETE_MS) {
  const codigo = `const { existsSync, rmSync } = require('node:fs'); const [pasta, ms] = process.argv.slice(1); const fim = Date.now() + Number(ms);
const t = setInterval(() => { if (!existsSync(pasta)) process.exit(0); if (Date.now() >= fim) { rmSync(pasta, { recursive: true, force: true }); process.exit(0); } }, 500);`;
  spawn(process.execPath, ['-e', codigo, pasta, String(ms)], { detached: true, stdio: 'ignore' }).unref();
}

/**
 * Abre o escritório. `executar(comando, argv)` devolve o código de saída e `limpar(pasta)` agenda o apagamento da pasta. Devolve o
 * código do processo e as linhas a imprimir; nenhuma delas contém o token nem o bilhete.
 */
export async function abrir({ env = process.env, home = env.HOME || homedir(), plataforma = process.platform, executar, limpar = iniciarLimpeza }) {
  const chave = readSecret({ ...env, HOME: home });
  if (!chave) {
    return {
      codigo: 1,
      linhas: [
        'Não achei um token válido em ~/.expediente/host/token.',
        'Rode npm run docker:up (ele cria o token) ou suba o servidor (npm run dev ou npm start: ele cria o token se faltar) e tente de novo.',
      ],
    };
  }
  const porta = portaDe(env);
  const r = await fetchComProva({ base: `http://127.0.0.1:${porta}`, chave, metodo: 'POST', caminho: '/api/token/bilhete', corpo: {}, timeoutMs: 5_000 });
  if (r.erro === 'nao-confere') return { codigo: 1, linhas: [`Quem responde na porta ${porta} não é o seu Expediente (a prova do token não confere). Não abri nada.`] };
  if (r.erro) return { codigo: 1, linhas: [`O Expediente não respondeu em http://127.0.0.1:${porta}. Suba com npm run docker:up e tente de novo.`] };
  const bilhete = r.json?.bilhete;
  if (r.status !== 200 || typeof bilhete !== 'string' || !BILHETE_FORMATO.test(bilhete)) {
    return { codigo: 1, linhas: [`O Expediente recusou o pedido de bilhete (HTTP ${r.status}). Confira o token em ~/.expediente/host/token e rode npm run docker:up de novo.`] };
  }
  const pasta = mkdtempSync(join(tmpdir(), 'expediente-abrir.'));
  chmodSync(pasta, 0o700);
  const arquivo = join(pasta, 'abrir.html');
  writeFileSync(arquivo, htmlDoEscritorio(urlDoEscritorio(bilhete, porta)), { mode: 0o600 });
  const codigo = executar(comandoDeAbrir(plataforma), [arquivo]);
  if (codigo !== 0) {
    rmSync(pasta, { recursive: true, force: true });
    return { codigo: 1, linhas: [`Não consegui abrir o navegador (${comandoDeAbrir(plataforma)} saiu com ${codigo}). Abra http://127.0.0.1:${porta} e rode npm run abrir de novo.`] };
  }
  limpar(pasta);
  return { codigo: 0, linhas: [`Abrindo http://127.0.0.1:${porta} no navegador padrão, já autorizado.`] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await abrir({ executar: (comando, argv) => spawnSync(comando, argv, { stdio: 'ignore' }).status ?? 1 });
  for (const l of r.linhas) console.log(l);
  process.exitCode = r.codigo;
}
