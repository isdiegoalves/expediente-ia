#!/usr/bin/env node
// Passos determinísticos do /tema (coleta de marca, paleta, pré-voo, aplicar e voltar ao padrão). Só `aplicar` e `padrao` escrevem tema-ativo.
// Uso: node scripts/tema/tema.mjs <preparar|paleta|css|rasterizar|montar|contraste|validar|capturar|aplicar|padrao> ...
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { aplicarPropostas, relatorio } from './contraste.mjs';
import { arquivoComumParaLer, cadeiaSegura, criarPasta, destinoGravavel, gravarArquivoComum, gravarTemaAtivo, idValido, lerTemaAtivo, nomePng, pastaDosTemas, recusarSeEmUso } from './confinar.mjs';
import { capturar, urlDaPrevia } from './captura.mjs';
import { caminhoSeguro, montar, RAIZ } from './marca.mjs';
import { ehPng, lerPng, MAX_BYTES_ENTRADA, quantizar } from './png.mjs';
import { rasterizar } from './svg.mjs';

const MAX_TEXTO = 1024 * 1024;

const pastaDoTema = (id) => {
  idValido(id);
  cadeiaSegura(homedir(), id);
  return join(pastaDosTemas(homedir()), id);
};
const lerTema = (id) => JSON.parse(readFileSync(join(pastaDoTema(id), 'tema.json'), 'utf8'));
const validarTema = (id) => spawnSync(process.execPath, [join(RAIZ, 'scripts/preflight-tema.mjs'), pastaDoTema(id)], { stdio: 'inherit' }).status ?? 1;
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
      const arq = arquivoComumParaLer(arquivoLocal(a), a);
      if (statSync(arq).size > MAX_BYTES_ENTRADA) throw new Error(`${a}: acima de ${MAX_BYTES_ENTRADA} bytes`);
      const buf = readFileSync(arq);
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
    cadeiaSegura(homedir(), id, 'referencias');
    destinoGravavel(join(pastaDosTemas(homedir()), id, 'referencias', nome));
    const png = rasterizar(arquivoLocal(svg), lado ? Number(lado) : 256);
    const pasta = criarPasta(homedir(), id, 'referencias');
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
    if (opcoes.includes('--ajustar')) recusarSeEmUso(homedir(), id);
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
    process.exitCode = validarTema(id);
  },

  async capturar([id, ...opcoes]) {
    const i = opcoes.indexOf('--porta');
    const bruta = i >= 0 ? opcoes[i + 1] : process.env.EXPEDIENTE_PORT ?? '4848';
    const porta = /^\d{1,5}$/.test(bruta ?? '') ? Number(bruta) : 0;
    if (porta < 1 || porta > 65535) throw new Error('porta inválida: use --porta <1 a 65535>');
    idValido(id);
    console.log(`Prévia no navegador, com os seus agentes: ${urlDaPrevia('localhost', porta, id)}\nPrévia no navegador, na demonstração: ${urlDaPrevia('localhost', porta, id, 'mock=1&')}`);
    const gravadas = await capturar({ id, porta });
    console.log(`\nCapturas do modo demonstração (nunca do escritório real):\n${gravadas.map((g) => `  ${g}`).join('\n')}`);
  },

  aplicar([id]) {
    if (id === 'padrao') throw new Error('para voltar ao tema padrão use o comando "padrao"');
    const doTema = JSON.parse(readFileSync(arquivoComumParaLer(join(pastaDoTema(id), 'tema.json'), 'tema.json'), 'utf8'));
    if (doTema.id !== id) throw new Error(`o id dentro de tema.json não é "${id}"; nada foi aplicado`);
    if (validarTema(id) !== 0) throw new Error(`o tema "${id}" não passou no pré-voo; nada foi aplicado`);
    const antes = lerTemaAtivo(homedir()) || 'padrao';
    console.log(`\nTema "${id}" aplicado (antes: ${antes}) em ${gravarTemaAtivo(homedir(), id)}. O escritório troca sozinho em alguns segundos.`);
  },

  padrao() {
    console.log(`Tema padrão restaurado em ${gravarTemaAtivo(homedir(), 'padrao')}. O escritório troca sozinho em alguns segundos.`);
  },
};

const [cmd, ...args] = process.argv.slice(2);
try {
  if (!comandos[cmd]) throw new Error(`comando desconhecido; use: ${Object.keys(comandos).join(', ')}`);
  await comandos[cmd](args);
} catch (e) {
  console.error(`ERRO: ${e.message}`);
  process.exitCode = e.codigo ?? 1;
}
