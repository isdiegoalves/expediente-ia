// SVG nunca é guardado: vira PNG pelo sips do macOS, depois de recusar o que um SVG de página de marca não precisa ter.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { arquivoComumParaLer } from './confinar.mjs';
import { gravarPng, lerPng } from './png.mjs';

const MAX_SVG = 1024 * 1024;
const PROIBIDOS = [
  [/<script/i, 'tem <script>'],
  [/<foreignObject/i, 'tem <foreignObject>'],
  [/<image/i, 'tem <image>'],
  [/<!ENTITY|<!DOCTYPE[^>]*\[/i, 'declara entidade ou DTD'],
  [/\son[a-z]+\s*=/i, 'tem atributo de evento'],
  [/href\s*=\s*["']?\s*(?!#)/i, 'aponta para fora com href'],
  [/url\(\s*["']?\s*(?!#)/i, 'aponta para fora com url()'],
  [/@import/i, 'tem @import'],
];

export function problemasDoSvg(texto) {
  return PROIBIDOS.filter(([re]) => re.test(texto)).map(([, motivo]) => motivo);
}

/** PNG (Buffer) do `svg`, de até `lado` px, conferido como imagem de verdade. Não escreve em lugar nenhum além de uma pasta temporária própria. */
export function rasterizar(svg, lado = 256) {
  if (!/\.svg$/i.test(svg)) throw new Error('a entrada precisa ser um arquivo .svg');
  arquivoComumParaLer(svg, 'svg');
  if (!Number.isInteger(lado) || lado < 8 || lado > 512) throw new Error('o lado precisa ser um inteiro entre 8 e 512');
  if (statSync(svg).size > MAX_SVG) throw new Error(`SVG acima de ${MAX_SVG} bytes`);
  const problemas = problemasDoSvg(readFileSync(svg, 'utf8'));
  if (problemas.length) throw new Error(`SVG recusado (${problemas.join('; ')}); peça ao dono um PNG do logo`);
  if (process.platform !== 'darwin') throw new Error('só há rasterizador de SVG no macOS (sips); peça ao dono um PNG do logo');
  const tmp = mkdtempSync(join(tmpdir(), 'tema-svg-'));
  try {
    const saida = join(tmp, 'saida.png');
    try {
      execFileSync('sips', ['-s', 'format', 'png', '-Z', String(lado), svg, '--out', saida], { stdio: 'pipe', timeout: 30_000 });
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
