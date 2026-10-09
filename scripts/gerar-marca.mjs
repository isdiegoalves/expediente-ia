#!/usr/bin/env node
// Gera em pixel art a marca do Expediente: logo, placa da recepção e ícones derivados (PNG, sem dependências).
// As cores saem de `paleta.marca` do tema padrão, então marca e UI usam os mesmos tons.
// Uso: node scripts/gerar-marca.mjs            grava os PNG em client/public
//      node scripts/gerar-marca.mjs --linhas    imprime as linhas do letreiro (WORDMARK_ROWS de client/src/ui/icons.ts)
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ------------------------------------------------------------------ PNG

function chunk(tipo, dados) {
  const corpo = Buffer.concat([Buffer.from(tipo, 'latin1'), dados]);
  const out = Buffer.alloc(12 + dados.length);
  out.writeUInt32BE(dados.length, 0);
  corpo.copy(out, 4);
  out.writeUInt32BE(crc32(corpo), 8 + dados.length);
  return out;
}

/** PNG RGBA 8 bits sem entrelaçamento; `px` é um Uint8Array w*h*4. */
export function codificarPng(w, h, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const linhas = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    linhas[y * (w * 4 + 1)] = 0;
    Buffer.from(px.buffer, px.byteOffset + y * w * 4, w * 4).copy(linhas, y * (w * 4 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(linhas, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// ------------------------------------------------------------------ tela

function rgba(hex) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(hex);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)).concat(m[2] ? parseInt(m[2], 16) : 255);
}

function misturar(a, b, t) {
  return a.map((v, i) => Math.round(v + (b[i] - v) * t));
}

class Tela {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h * 4);
  }

  ponto(x, y, cor) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(cor, (y * this.w + x) * 4);
  }

  ler(x, y) {
    const i = (y * this.w + x) * 4;
    return [...this.px.subarray(i, i + 4)];
  }

  ret(x, y, w, h, cor) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.ponto(x + i, y + j, cor);
  }

  contorno(x, y, w, h, cor) {
    this.ret(x, y, w, 1, cor);
    this.ret(x, y + h - 1, w, 1, cor);
    this.ret(x, y, 1, h, cor);
    this.ret(x + w - 1, y, 1, h, cor);
  }

  /** Ampliação por vizinho mais próximo (pixel art continua nítida). */
  ampliar(k) {
    const t = new Tela(this.w * k, this.h * k);
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) t.ponto(x, y, this.ler(Math.floor(x / k), Math.floor(y / k)));
    return t;
  }

  /** Centra esta tela, ampliada por `k`, num fundo opaco ou transparente de w x h. */
  centrar(w, h, k, fundo) {
    const t = new Tela(w, h);
    if (fundo) t.ret(0, 0, w, h, fundo);
    const g = this.ampliar(k);
    const ox = Math.floor((w - g.w) / 2);
    const oy = Math.floor((h - g.h) / 2);
    for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.ler(x, y)[3]) t.ponto(ox + x, oy + y, g.ler(x, y));
    return t;
  }

  /** Reduz à metade: em cada bloco 2x2 fica o pixel opaco mais escuro (preserva o contorno). */
  metade() {
    const t = new Tela(this.w / 2, this.h / 2);
    for (let y = 0; y < t.h; y++) {
      for (let x = 0; x < t.w; x++) {
        const bloco = [this.ler(2 * x, 2 * y), this.ler(2 * x + 1, 2 * y), this.ler(2 * x, 2 * y + 1), this.ler(2 * x + 1, 2 * y + 1)].filter((c) => c[3]);
        bloco.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
        if (bloco.length) t.ponto(x, y, bloco[0]);
      }
    }
    return t;
  }

  png() {
    return codificarPng(this.w, this.h, this.px);
  }
}

// ------------------------------------------------------------------ letreiro

const GLIFOS = {
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
};

const NOME = 'EXPEDIENTE';
/** Quantas letras ficam na cor do texto; o resto leva a cor de destaque. */
const LETRAS_CLARAS = 5;

/** Linhas do letreiro: c = texto, t = destaque, s = sombra de 1 px abaixo de cada pixel. */
export function linhasDoLetreiro() {
  const linhas = Array.from({ length: 8 }, () => []);
  [...NOME].forEach((letra, i) => {
    const g = GLIFOS[letra];
    const cor = i < LETRAS_CLARAS ? 'c' : 't';
    for (let y = 0; y < 7; y++) for (const c of g[y]) linhas[y].push(c === '#' ? cor : '.');
    linhas[7].push(...Array(g[0].length).fill('.'));
    if (i < NOME.length - 1) for (const l of linhas) l.push('.');
  });
  for (let y = 1; y < 8; y++) linhas[y] = linhas[y].map((c, x) => (c === '.' && /[ct]/.test(linhas[y - 1][x]) ? 's' : c));
  return linhas.map((l) => l.join(''));
}

// ------------------------------------------------------------------ imagem de prévia

// Fonte 3x5 para o texto corrido da imagem de prévia; "Ó" é o O com um pingo acima.
const MINI = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'], C: ['.##', '#..', '#..', '#..', '.##'], D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'], G: ['.##', '#..', '#.#', '#.#', '.##'], I: ['###', '.#.', '.#.', '.#.', '###'],
  L: ['#..', '#..', '#..', '#..', '###'], M: ['#.#', '###', '###', '#.#', '#.#'], N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'], P: ['##.', '#.#', '##.', '#..', '#..'], R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'], T: ['###', '.#.', '.#.', '.#.', '.#.'], U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'], X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  ',': ['...', '...', '...', '.#.', '#..'], '.': ['...', '...', '...', '...', '.#.'], ' ': ['..', '..', '..', '..', '..'],
};

function escrever(tela, frase, x, y, cor) {
  let cx = x;
  for (const ch of frase) {
    const g = MINI[ch === 'Ó' ? 'O' : ch];
    g.forEach((linha, j) => [...linha].forEach((c, i) => c === '#' && tela.ponto(cx + i, y + j, cor)));
    if (ch === 'Ó') tela.ponto(cx + 2, y - 2, cor);
    cx += g[0].length + 1;
  }
}

/** Imagem de prévia 1200x630 (240x126 ampliada 5x): céu com estrelas, linha de prédios, logo, letreiro e legenda. */
function gerarPrevia(tema, logo) {
  const { simbolo, letreiro } = tema.paleta.marca;
  const [contorno, parede, acento, aceso, azul, escuro] = simbolo.map(rgba);
  const fundo = rgba(tema.paleta.ui.fundoSolido.slice(0, 7));
  const ceu = misturar(fundo, escuro, 0.5);
  const t = new Tela(240, 126);
  t.ret(0, 0, 240, 126, ceu);
  let semente = 7;
  const alea = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 70; i++) t.ponto(Math.floor(alea() * 240), Math.floor(alea() * 60), misturar(ceu, parede, 0.25 + alea() * 0.5));
  // linha de prédios ao fundo
  for (let x = 0, n = 0; x < 240; n++) {
    const w = 10 + Math.floor(alea() * 12);
    const h = 14 + Math.floor(alea() * 30);
    const cor = misturar(escuro, contorno, 0.4 + alea() * 0.4);
    t.ret(x, 76 - h, w - 1, h, cor);
    for (let wy = 76 - h + 3; wy < 74; wy += 5) for (let wx = x + 2; wx < x + w - 3; wx += 4) if (alea() < 0.45) t.ponto(wx, wy, alea() < 0.7 ? aceso : azul);
    x += w;
  }
  t.ret(0, 76, 240, 50, misturar(fundo, contorno, 0.3));
  t.ret(0, 76, 240, 1, misturar(contorno, parede, 0.3));
  // logo, letreiro (2x) e legenda
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) if (logo.ler(x, y)[3]) t.ponto(22 + x, 84 + y - 8, logo.ler(x, y));
  const [sombraL, textoL, destaqueL] = letreiro.map(rgba);
  const cores = { c: textoL, t: destaqueL, s: sombraL.slice(0, 3).concat(200) };
  linhasDoLetreiro().forEach((linha, y) => [...linha].forEach((c, x) => cores[c] && t.ret(66 + x * 2, 80 + y * 2, 2, 2, cores[c])));
  escrever(t, 'AGENTES DO CLAUDE CODE, AO VIVO,', 66, 100, misturar(parede, ceu, 0.15));
  escrever(t, 'NUM ESCRITÓRIO EM PIXEL ART.', 66, 108, misturar(parede, ceu, 0.15));
  t.ret(0, 0, 240, 1, acento);
  return t.ampliar(5);
}

// ------------------------------------------------------------------ marca

export function gerarMarca(tema) {
  const { simbolo, letreiro } = tema.paleta.marca;
  const [contorno, parede, acento, aceso, azul, escuro] = simbolo.map(rgba);
  const sombra = misturar(parede, contorno, 0.28);
  const brilho = misturar(aceso, [255, 255, 255, 255], 0.45);
  const relogio = misturar(parede, [255, 255, 255, 255], 0.6);

  // logo 32x32: prédio com relógio na torre
  const l = new Tela(32, 32);
  l.ret(13, 3, 6, 6, contorno);
  l.ret(14, 4, 4, 4, relogio);
  l.ponto(15, 5, contorno);
  l.ponto(16, 5, contorno);
  l.ponto(16, 6, contorno);
  l.ret(12, 2, 8, 1, acento);
  l.ret(5, 9, 22, 1, contorno);
  l.ret(4, 10, 24, 2, acento);
  l.ret(4, 12, 24, 1, contorno);
  l.ret(5, 13, 22, 17, contorno);
  l.ret(6, 13, 20, 16, parede);
  l.ret(6, 13, 20, 1, sombra);
  l.ret(3, 29, 26, 2, contorno);
  l.ret(4, 30, 24, 1, escuro);
  const janelas = [
    [7, 15, aceso],
    [14, 15, azul],
    [21, 15, aceso],
    [7, 21, azul],
    [14, 21, aceso],
    [21, 21, aceso],
  ];
  for (const [x, y, cor] of janelas) {
    l.contorno(x - 1, y - 1, 6, 6, contorno);
    l.ret(x, y, 4, 4, cor);
    l.ret(x, y, 4, 1, cor === aceso ? brilho : misturar(azul, [255, 255, 255, 255], 0.4));
  }
  l.contorno(13, 24, 6, 6, contorno);
  l.ret(14, 25, 4, 5, escuro);
  l.ponto(17, 27, aceso);

  // placa 64x16: letreiro em pixels sobre uma chapa escura
  const [sombraL, textoL, destaqueL] = letreiro.map(rgba);
  const chapa = misturar(escuro, contorno, 0.5);
  const borda = misturar(chapa, parede, 0.28);
  const p = new Tela(64, 16);
  p.ret(0, 0, 64, 16, borda);
  p.ret(1, 1, 62, 14, chapa);
  p.ret(1, 1, 62, 1, misturar(chapa, parede, 0.1));
  const linhas = linhasDoLetreiro();
  const x0 = Math.floor((64 - linhas[0].length) / 2);
  const y0 = 4;
  const cores = { c: textoL, t: destaqueL, s: misturar(chapa, sombraL.slice(0, 3).concat(255), (sombraL[3] || 255) / 255) };
  linhas.forEach((linha, y) => [...linha].forEach((c, x) => cores[c] && p.ponto(x0 + x, y0 + y, cores[c])));

  const fundoApple = rgba(tema.paleta.ui.fundoSolido.slice(0, 7));
  const arquivos = new Map();
  const colocar = (rel, tela) => arquivos.set(rel, tela.png());
  colocar('client/public/temas/padrao/brand/logo-mark.png', l);
  colocar('client/public/temas/padrao/brand/signage.png', p);
  colocar('client/public/assets/brand/logo-mark@4x.png', l.ampliar(4));
  colocar('client/public/assets/brand/signage@4x.png', p.ampliar(4));
  colocar('client/public/assets/brand/favicon-32.png', l);
  colocar('client/public/assets/brand/favicon-16.png', l.metade());
  colocar('client/public/assets/brand/apple-touch-icon.png', l.centrar(180, 180, 5, fundoApple));
  colocar('client/public/assets/brand/icon-192.png', l.ampliar(6));
  colocar('client/public/assets/brand/icon-512.png', l.ampliar(16));
  colocar('client/public/assets/og-image.png', gerarPrevia(tema, l));
  return arquivos;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes('--linhas')) {
    console.log(linhasDoLetreiro().map((l) => `  '${l}',`).join('\n'));
  } else {
    const tema = JSON.parse(readFileSync(join(RAIZ, 'client/public/temas/padrao/tema.json'), 'utf8'));
    for (const [rel, png] of gerarMarca(tema)) {
      mkdirSync(dirname(join(RAIZ, rel)), { recursive: true });
      writeFileSync(join(RAIZ, rel), png);
      console.log(`${rel} (${png.length} bytes)`);
    }
  }
}
