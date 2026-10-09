#!/usr/bin/env node
// Renomeação mecânica Habblaud -> Expediente. Idempotente: uma segunda execução não encontra nada para trocar.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const raiz = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const git = (...args) => execFileSync('git', args, { cwd: raiz, encoding: 'utf8', maxBuffer: 1 << 28 });

const PRESERVADOS = new Set(['LICENSE', 'NOTICE', 'scripts/renomear-fork.mjs', 'server/test/nomes.test.ts']);
const LINHA_DE_ORIGEM = '> **Origem.**';
const REPOSITORIO_ORIGINAL = /marmottajr\/habblaud/gi;
const MARCA = '\u0000REPO_ORIGINAL\u0000';

const comando = /(?<![\w./~@-])\/habblaud(?![\w/-]|\.\w)/g;
const COMANDO_DO_MOD = new Set(['mod/habblaud/hooks/register.ts', 'mod/habblaud/tests/habblaud.test.ts']);
const vite = (arquivo) => ['vite.config.ts', 'README.md'].includes(arquivo);

function renomeiaTexto(texto, arquivo) {
  const guardados = [];
  let saida = texto.replace(REPOSITORIO_ORIGINAL, (m) => (guardados.push(m), MARCA));
  saida = saida
    .replace(comando, '/escritorio')
    .replace(/'habblaud'/g, COMANDO_DO_MOD.has(arquivo) ? "'escritorio'" : "'habblaud'")
    .replaceAll('habblaud', 'expediente')
    .replaceAll('Habblaud', 'Expediente')
    .replaceAll('HABBLAUD', 'EXPEDIENTE')
    .replace(/\b4747\b/g, '4848');
  if (vite(arquivo)) saida = saida.replace(/\b5173\b/g, '5848');
  let i = 0;
  return saida.replaceAll(MARCA, () => guardados[i++]);
}

function renomeiaConteudo(texto, arquivo) {
  if (arquivo !== 'README.md') return renomeiaTexto(texto, arquivo);
  return texto
    .split('\n')
    .map((linha) => (linha.startsWith(LINHA_DE_ORIGEM) ? linha : renomeiaTexto(linha, arquivo)))
    .join('\n');
}

const arquivos = git('ls-files', '-z').split('\0').filter(Boolean);
let alterados = 0;
let movidos = 0;
for (const arquivo of arquivos) {
  if (PRESERVADOS.has(arquivo)) continue;
  const bruto = readFileSync(`${raiz}/${arquivo}`);
  if (bruto.includes(0)) continue;
  const antes = bruto.toString('utf8');
  const depois = renomeiaConteudo(antes, arquivo);
  const destino = renomeiaTexto(arquivo, arquivo);
  if (depois !== antes) {
    writeFileSync(`${raiz}/${arquivo}`, depois);
    alterados++;
  }
  if (destino !== arquivo) {
    mkdirSync(dirname(`${raiz}/${destino}`), { recursive: true });
    git('mv', '--', arquivo, destino);
    movidos++;
  }
}
console.log(`${alterados} arquivos reescritos, ${movidos} movidos`);
