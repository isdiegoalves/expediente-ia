#!/usr/bin/env node
// Passos determinísticos do /tema (coleta de marca, paleta e pré-voo). Não aplica tema: não escreve tema-ativo.
// Uso: node scripts/tema/tema.mjs <preparar|paleta|css|rasterizar|montar|contraste|validar> ...
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { aplicarPropostas, relatorio } from './contraste.mjs';
import { arquivoComumParaLer, cadeiaSegura, criarPasta, destinoGravavel, gravarArquivoComum, idValido, nomePng, pastaDosTemas } from './confinar.mjs';
import { caminhoSeguro, montar, RAIZ } from './marca.mjs';
import { ehPng, lerPng, quantizar } from './png.mjs';
import { rasterizar } from './svg.mjs';

const MAX_TEXTO = 1024 * 1024;

const pastaDoTema = (id) => {
  idValido(id);
  cadeiaSegura(homedir(), id);
  return join(pastaDosTemas(homedir()), id);
};
const lerTema = (id) => JSON.parse(readFileSync(join(pastaDoTema(id), 'tema.json'), 'utf8'));
const pf = (n) => `${(n * 100).toFixed(1).replace('.', ',')}%`;

function arquivoLocal(caminho) {
  const e = caminhoSeguro(caminho, 'arquivo');
  if (e) throw new Error(e);
  return resolve(caminho);
}

const comandos = {
  preparar([id]) {
    idValido(id);
    console.log(criarPasta(homedir(), id, 'referencias'));
  },

  paleta(args) {
    const quantas = 6;
    if (!args.length) throw new Error('uso: paleta <imagem.png>...');
    for (const a of args) {
      const buf = readFileSync(arquivoComumParaLer(arquivoLocal(a), a));
      if (!ehPng(buf)) throw new Error(`${a}: não é PNG (SVG se rasteriza antes; outro formato, peça um PNG)`);
      console.log(`${a}`);
      for (const { cor, parte } of quantizar(lerPng(buf), quantas)) console.log(`  ${cor}  ${pf(parte)}`);
    }
  },

  css(args) {
    if (!args.length) throw new Error('uso: css <arquivo.css|.html>...');
    const contagem = new Map();
    for (const a of args) {
      const arq = arquivoComumParaLer(arquivoLocal(a), a);
      if (statSync(arq).size > MAX_TEXTO) throw new Error(`${a}: acima de ${MAX_TEXTO} bytes`);
      for (const [, h] of readFileSync(arq, 'utf8').matchAll(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-zA-Z_-])/g)) {
        const cheio = h.length === 3 ? [...h].map((c) => c + c).join('') : h.slice(0, 6);
        const cor = `#${cheio.toLowerCase()}`;
        contagem.set(cor, (contagem.get(cor) ?? 0) + 1);
      }
    }
    for (const [cor, n] of [...contagem].sort((x, y) => y[1] - x[1]).slice(0, 20)) console.log(`${cor}  ${n}x`);
  },

  rasterizar([svg, id, nome, lado]) {
    if (!svg || !id || nome === undefined) throw new Error('uso: rasterizar <entrada.svg> <id-do-tema> <nome.png> [lado]');
    idValido(id);
    nomePng(nome);
    const pasta = criarPasta(homedir(), id, 'referencias');
    destinoGravavel(join(pasta, nome));
    const png = rasterizar(arquivoLocal(svg), lado ? Number(lado) : 256);
    gravarArquivoComum(join(pasta, nome), png);
    const { largura, altura } = lerPng(png);
    console.log(`${join(pasta, nome)}: ${largura}x${altura}`);
  },

  montar([arquivo, ...opcoes]) {
    if (!arquivo) throw new Error('uso: montar <marca.json> [--refazer]');
    const caminho = arquivoComumParaLer(arquivoLocal(arquivo), arquivo);
    if (statSync(caminho).size > 64 * 1024) throw new Error('marca.json acima de 64 KB');
    const pasta = montar(JSON.parse(readFileSync(caminho, 'utf8')), { home: homedir(), baseDir: dirname(caminho), refazer: opcoes.includes('--refazer') });
    const id = pasta.split('/').pop();
    console.log(`Tema candidato gravado em ${pasta} (não aplicado).\n`);
    console.log(relatorio(lerTema(id)).texto);
  },

  contraste([id, ...opcoes]) {
    const tema = lerTema(id);
    const { texto, reprovados, propostas } = relatorio(tema);
    console.log(texto);
    if (opcoes.includes('--ajustar') && reprovados) {
      const novo = aplicarPropostas(tema, propostas);
      gravarArquivoComum(join(pastaDoTema(id), 'tema.json'), `${JSON.stringify(novo, null, 2)}\n`);
      console.log(`\nAjuste gravado em ${join(pastaDoTema(id), 'tema.json')}. Depois do ajuste:\n`);
      const depois = relatorio(novo);
      console.log(depois.texto);
      process.exitCode = depois.reprovados ? 1 : 0;
    } else process.exitCode = reprovados ? 1 : 0;
  },

  validar([id]) {
    const r = spawnSync(process.execPath, [join(RAIZ, 'scripts/preflight-tema.mjs'), pastaDoTema(id)], { stdio: 'inherit' });
    process.exitCode = r.status ?? 1;
  },
};

const [cmd, ...args] = process.argv.slice(2);
try {
  if (!comandos[cmd]) throw new Error(`comando desconhecido; use: ${Object.keys(comandos).join(', ')}`);
  comandos[cmd](args);
} catch (e) {
  console.error(`ERRO: ${e.message}`);
  process.exitCode = 1;
}
