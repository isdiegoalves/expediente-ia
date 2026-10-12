// SVG nunca é guardado: é lido por um leitor estrito, reescrito só com o que a lista de permitidos aceita e esse texto novo
// vira PNG pelo sips do macOS.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arquivoComumParaLer } from './confinar.mjs';
import { gravarPng, lerPng } from './png.mjs';

const MAX_SVG = 1024 * 1024;
const NUM = String.raw`-?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?`;
const COR = String.raw`none|currentColor|#[0-9a-fA-F]{3,8}|[a-zA-Z]{3,20}|url\(#[A-Za-z][\w-]{0,40}\)`;
const REF = String.raw`url\(#[A-Za-z][\w-]{0,40}\)`;
const em = (re) => new RegExp(`^(?:${re})$`);
const FUNCAO = em(String.raw`(?:translate|scale|rotate|skewX|skewY|matrix)\(\s*${NUM}(?:[\s,]+${NUM}){0,5}`);
const MAX_FUNCOES = 16;

/** Cada função separada por ")" e conferida sozinha, sem repetição aninhada numa regex só. */
function transformOk(valor) {
  const partes = valor.split(')');
  if (partes.length < 2 || partes.length > MAX_FUNCOES + 1 || partes.pop().trim()) return false;
  return partes.every((p) => FUNCAO.test(p.trim()));
}
const UNID = String.raw`${NUM}(?:px|%)?`;

const VALORES = {
  id: em(String.raw`[A-Za-z][\w-]{0,40}`),
  x: em(UNID), y: em(UNID), width: em(UNID), height: em(UNID), cx: em(UNID), cy: em(UNID), r: em(UNID), rx: em(UNID), ry: em(UNID),
  x1: em(UNID), y1: em(UNID), x2: em(UNID), y2: em(UNID), fx: em(UNID), fy: em(UNID), offset: em(UNID),
  viewBox: em(String.raw`${NUM}(?:[\s,]+${NUM}){3}`),
  points: em(String.raw`[-\d.eE\s,+]{1,20000}`),
  d: em(String.raw`[MmLlHhVvCcSsQqTtAaZz\d.eE\s,+-]{1,40000}`),
  transform: { test: transformOk }, gradientTransform: { test: transformOk },
  fill: em(COR), stroke: em(COR), 'stop-color': em(COR),
  opacity: em(NUM), 'fill-opacity': em(NUM), 'stroke-opacity': em(NUM), 'stop-opacity': em(NUM), 'stroke-width': em(UNID), 'stroke-miterlimit': em(NUM),
  'fill-rule': em('nonzero|evenodd'), 'clip-rule': em('nonzero|evenodd'),
  'stroke-linecap': em('butt|round|square'), 'stroke-linejoin': em('miter|round|bevel'),
  gradientUnits: em('userSpaceOnUse|objectBoundingBox'), spreadMethod: em('pad|reflect|repeat'),
  xmlns: em('http://www\\.w3\\.org/2000/svg'),
  version: em('1\\.[01]'),
};
const TETO = { d: 40_000, points: 20_000, transform: 1_000, gradientTransform: 1_000 };
const TETO_PADRAO = 64;
const FORMA = ['id', 'transform', 'fill', 'stroke', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-width', 'stroke-miterlimit', 'stroke-linecap', 'stroke-linejoin', 'fill-rule', 'clip-rule'];
const ELEMENTOS = {
  svg: ['xmlns', 'version', 'viewBox', 'width', 'height', ...FORMA],
  g: FORMA,
  defs: ['id'],
  path: ['d', ...FORMA],
  rect: ['x', 'y', 'width', 'height', 'rx', 'ry', ...FORMA],
  circle: ['cx', 'cy', 'r', ...FORMA],
  ellipse: ['cx', 'cy', 'rx', 'ry', ...FORMA],
  line: ['x1', 'y1', 'x2', 'y2', ...FORMA],
  polyline: ['points', ...FORMA],
  polygon: ['points', ...FORMA],
  linearGradient: ['id', 'x1', 'y1', 'x2', 'y2', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
  radialGradient: ['id', 'cx', 'cy', 'r', 'fx', 'fy', 'gradientUnits', 'gradientTransform', 'spreadMethod'],
  stop: ['offset', 'stop-color', 'stop-opacity'],
};
const MAX_ELEMENTOS = 5000;
const MAX_PROFUNDIDADE = 32;
const recusa = (motivo) => new Error(`SVG recusado (${motivo}); peça ao dono um PNG do logo`);
const TAG = /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:\s+[A-Za-z][A-Za-z0-9-]*\s*=\s*(?:"[^"<>&]*"|'[^'<>&]*'))*)\s*(\/?)>/y;
const ATRIBUTO = /\s+([A-Za-z][A-Za-z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * Lê o SVG com um leitor mínimo e estrito e devolve um SVG novo só com o que a lista de permitidos aceita: elementos de
 * forma e gradiente, atributos de geometria e cor com valor validado. Qualquer outra coisa é recusa. É esse texto, nunca
 * o original, que vai para o rasterizador.
 */
export function reescreverSvg(buf) {
  if (buf.length > MAX_SVG) throw recusa('maior que o limite');
  if ((buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff)) throw recusa('UTF-16 não é aceito, só UTF-8');
  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw recusa('não é UTF-8 válido');
  }
  if (texto.includes('\u0000')) throw recusa('byte nulo, provável UTF-16');
  texto = texto.replace(/^﻿/, '');

  let pos = 0;
  const decl = /^\s*<\?xml\s+version\s*=\s*["']1\.[01]["'](?:\s+encoding\s*=\s*["']([^"']*)["'])?(?:\s+standalone\s*=\s*["'](?:yes|no)["'])?\s*\?>/.exec(texto);
  if (decl) {
    if (decl[1] && decl[1].toLowerCase() !== 'utf-8') throw recusa('encoding diferente de UTF-8');
    pos = decl[0].length;
  }
  const pilha = [];
  const saida = [];
  let raizFechada = false;
  let elementos = 0;
  while (pos < texto.length) {
    if (texto[pos] !== '<') {
      const fim = texto.indexOf('<', pos);
      const miolo = texto.slice(pos, fim === -1 ? undefined : fim);
      if (/\S/.test(miolo)) throw recusa('texto solto fora de elemento');
      pos = fim === -1 ? texto.length : fim;
      continue;
    }
    if (texto.startsWith('<!--', pos)) {
      const fim = texto.indexOf('-->', pos + 4);
      if (fim === -1 || texto.slice(pos + 4, fim).includes('--')) throw recusa('comentário malformado');
      pos = fim + 3;
      continue;
    }
    if (texto.startsWith('<!', pos)) throw recusa('DOCTYPE, entidade ou CDATA');
    if (texto.startsWith('<?', pos)) throw recusa('instrução de processamento');
    TAG.lastIndex = pos;
    const m = TAG.exec(texto);
    if (!m) throw recusa('marcação fora do vocabulário (prefixo de namespace, atributo, aspas ou "&")');
    pos += m[0].length;
    const [, fecha, nome, atributos, autoFecha] = m;
    if (fecha) {
      if (autoFecha || atributos.trim() || pilha.pop() !== nome) throw recusa('tags desbalanceadas');
      saida.push(`</${nome}>`);
      if (!pilha.length) raizFechada = true;
      continue;
    }
    if (raizFechada) throw recusa('mais de um elemento raiz');
    if (!pilha.length && nome !== 'svg') throw recusa('o elemento raiz precisa ser svg');
    if (!Object.hasOwn(ELEMENTOS, nome)) throw recusa(`elemento <${nome}> fora da lista`);
    if (++elementos > MAX_ELEMENTOS) throw recusa('elementos demais');
    const ok = [];
    const vistos = new Set();
    for (const [, an, v1, v2] of atributos.matchAll(ATRIBUTO)) {
      const valor = v1 ?? v2;
      if (!ELEMENTOS[nome].includes(an) || !Object.hasOwn(VALORES, an)) throw recusa(`atributo ${an} fora da lista em <${nome}>`);
      if (vistos.has(an)) throw recusa(`atributo ${an} repetido`);
      vistos.add(an);
      if (valor.length > (TETO[an] ?? TETO_PADRAO) || !VALORES[an].test(valor.trim())) throw recusa(`valor de ${an} fora do formato`);
      ok.push(`${an}="${valor.trim()}"`);
    }
    saida.push(`<${[nome, ...ok].join(' ')}${autoFecha ? '/' : ''}>`);
    if (autoFecha) {
      if (!pilha.length) raizFechada = true;
    } else {
      pilha.push(nome);
      if (pilha.length > MAX_PROFUNDIDADE) throw recusa('aninhamento demais');
    }
  }
  if (pilha.length || !raizFechada) throw recusa('SVG vazio ou incompleto');
  return saida.join('');
}

/** PNG (Buffer) do `svg`, de até `lado` px, conferido como imagem de verdade. Não escreve em lugar nenhum além de uma pasta temporária própria. */
export function rasterizar(svg, lado = 256) {
  if (!/\.svg$/i.test(svg)) throw new Error('a entrada precisa ser um arquivo .svg');
  arquivoComumParaLer(svg, 'svg');
  if (!Number.isInteger(lado) || lado < 8 || lado > 512) throw new Error('o lado precisa ser um inteiro entre 8 e 512');
  if (statSync(svg).size > MAX_SVG) throw new Error(`SVG acima de ${MAX_SVG} bytes`);
  const limpo = reescreverSvg(readFileSync(svg));
  if (process.platform !== 'darwin') throw new Error('só há rasterizador de SVG no macOS (sips); peça ao dono um PNG do logo');
  const tmp = mkdtempSync(join(tmpdir(), 'tema-svg-'));
  try {
    const entrada = join(tmp, 'limpo.svg');
    writeFileSync(entrada, limpo);
    const saida = join(tmp, 'saida.png');
    try {
      execFileSync('sips', ['-s', 'format', 'png', '-Z', String(lado), entrada, '--out', saida], { stdio: 'pipe', timeout: 30_000 });
    } catch (e) {
      throw new Error(`o sips não rasterizou o SVG (${String(e.message).split('\n')[0]}); peça ao dono um PNG do logo`);
    }
    const img = lerPng(readFileSync(saida));
    let visivel = 0;
    const cores = new Set();
    for (let i = 0; i < img.rgba.length; i += 4) {
      if (img.rgba[i + 3] > 0) visivel++;
      cores.add((img.rgba[i] << 16) | (img.rgba[i + 1] << 8) | img.rgba[i + 2] | (img.rgba[i + 3] << 24));
    }
    if (!visivel || cores.size < 2) throw new Error('o sips devolveu uma imagem vazia ou lisa; peça ao dono um PNG do logo');
    return gravarPng(img);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
