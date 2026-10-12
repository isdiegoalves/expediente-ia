// PNG sem dependência: leitura (todos os tipos de cor, sem entrelaçamento), gravação, redução por média de área e
// quantização de paleta. Imagem de fora é dado não confiável: tamanho e dimensões têm teto antes de qualquer inflate.
import { crc32, deflateSync, inflateSync } from 'node:zlib';

const ASSINATURA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
export const MAX_BYTES_ENTRADA = 4 * 1024 * 1024;
export const MAX_LADO_ENTRADA = 4096;
const MAX_PIXELS_ENTRADA = 16_000_000;
const CANAIS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

export const ehPng = (b) => b.length >= 8 && b.subarray(0, 8).equals(ASSINATURA);

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** { largura, altura, rgba } a partir de um PNG; lança Error com mensagem em português se não der. */
export function lerPng(buf) {
  if (buf.length > MAX_BYTES_ENTRADA) throw new Error(`PNG de ${buf.length} bytes passa do teto de ${MAX_BYTES_ENTRADA}`);
  if (!ehPng(buf)) throw new Error('o arquivo não é um PNG');
  let pos = 8;
  let cab = null;
  let paleta = null;
  let transp = null;
  const dados = [];
  while (pos + 8 <= buf.length) {
    const tam = buf.readUInt32BE(pos);
    const tipo = buf.toString('latin1', pos + 4, pos + 8);
    const corpo = buf.subarray(pos + 8, pos + 8 + tam);
    if (corpo.length < tam) throw new Error('PNG truncado');
    if (tipo === 'IHDR') cab = { l: corpo.readUInt32BE(0), a: corpo.readUInt32BE(4), prof: corpo[8], cor: corpo[9], entrelaca: corpo[12] };
    else if (tipo === 'PLTE') paleta = corpo;
    else if (tipo === 'tRNS') transp = corpo;
    else if (tipo === 'IDAT') dados.push(corpo);
    else if (tipo === 'IEND') break;
    pos += 12 + tam;
  }
  if (!cab || !dados.length) throw new Error('PNG sem cabeçalho ou sem dados');
  if (cab.entrelaca) throw new Error('PNG entrelaçado não é suportado; reexporte sem entrelaçamento');
  if (!(cab.cor in CANAIS) || ![1, 2, 4, 8, 16].includes(cab.prof)) throw new Error('combinação de cor e profundidade não suportada');
  if (cab.l < 1 || cab.a < 1 || cab.l > MAX_LADO_ENTRADA || cab.a > MAX_LADO_ENTRADA || cab.l * cab.a > MAX_PIXELS_ENTRADA) {
    throw new Error(`PNG de ${cab.l}x${cab.a} passa do teto de ${MAX_LADO_ENTRADA}px por lado`);
  }
  if (cab.cor === 3 && !paleta) throw new Error('PNG indexado sem paleta');

  const bitsPixel = CANAIS[cab.cor] * cab.prof;
  const bpp = Math.max(1, bitsPixel >> 3);
  const linha = Math.ceil((cab.l * bitsPixel) / 8);
  const bruto = inflateSync(Buffer.concat(dados), { maxOutputLength: (linha + 1) * cab.a });
  if (bruto.length < (linha + 1) * cab.a) throw new Error('PNG com dados de menos');

  const img = Buffer.alloc(linha * cab.a);
  for (let y = 0; y < cab.a; y++) {
    const filtro = bruto[y * (linha + 1)];
    const ini = y * (linha + 1) + 1;
    for (let x = 0; x < linha; x++) {
      const bruta = bruto[ini + x];
      const esq = x >= bpp ? img[y * linha + x - bpp] : 0;
      const cima = y ? img[(y - 1) * linha + x] : 0;
      const diag = y && x >= bpp ? img[(y - 1) * linha + x - bpp] : 0;
      let v;
      if (filtro === 0) v = bruta;
      else if (filtro === 1) v = bruta + esq;
      else if (filtro === 2) v = bruta + cima;
      else if (filtro === 3) v = bruta + ((esq + cima) >> 1);
      else if (filtro === 4) v = bruta + paeth(esq, cima, diag);
      else throw new Error('filtro de linha inválido');
      img[y * linha + x] = v & 255;
    }
  }

  const rgba = new Uint8Array(cab.l * cab.a * 4);
  const amostra = (y, i) => {
    if (cab.prof === 8) return img[y * linha + i];
    if (cab.prof === 16) return img[y * linha + i * 2];
    const bit = i * cab.prof;
    const byte = img[y * linha + (bit >> 3)];
    return (byte >> (8 - cab.prof - (bit & 7))) & ((1 << cab.prof) - 1);
  };
  const escala = cab.prof < 8 ? 255 / ((1 << cab.prof) - 1) : 1;
  for (let y = 0; y < cab.a; y++) {
    for (let x = 0; x < cab.l; x++) {
      const o = (y * cab.l + x) * 4;
      if (cab.cor === 3) {
        const idx = amostra(y, x);
        if (idx * 3 + 2 >= paleta.length) throw new Error('índice fora da paleta');
        rgba.set([paleta[idx * 3], paleta[idx * 3 + 1], paleta[idx * 3 + 2], transp && idx < transp.length ? transp[idx] : 255], o);
      } else if (cab.cor === 0) {
        const g = Math.round(amostra(y, x) * escala);
        rgba.set([g, g, g, 255], o);
      } else if (cab.cor === 4) {
        const g = amostra(y, x * 2);
        rgba.set([g, g, g, amostra(y, x * 2 + 1)], o);
      } else if (cab.cor === 2) {
        rgba.set([amostra(y, x * 3), amostra(y, x * 3 + 1), amostra(y, x * 3 + 2), 255], o);
      } else {
        rgba.set([amostra(y, x * 4), amostra(y, x * 4 + 1), amostra(y, x * 4 + 2), amostra(y, x * 4 + 3)], o);
      }
    }
  }
  return { largura: cab.l, altura: cab.a, rgba };
}

function bloco(tipo, corpo) {
  const cabeca = Buffer.alloc(8);
  cabeca.writeUInt32BE(corpo.length, 0);
  cabeca.write(tipo, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([cabeca.subarray(4), corpo])) >>> 0, 0);
  return Buffer.concat([cabeca, corpo, crc]);
}

export function gravarPng({ largura, altura, rgba }) {
  const cab = Buffer.alloc(13);
  cab.writeUInt32BE(largura, 0);
  cab.writeUInt32BE(altura, 4);
  cab.set([8, 6, 0, 0, 0], 8);
  const linhas = Buffer.alloc((largura * 4 + 1) * altura);
  for (let y = 0; y < altura; y++) {
    linhas[y * (largura * 4 + 1)] = 0;
    linhas.set(rgba.subarray(y * largura * 4, (y + 1) * largura * 4), y * (largura * 4 + 1) + 1);
  }
  return Buffer.concat([ASSINATURA, bloco('IHDR', cab), bloco('IDAT', deflateSync(linhas)), bloco('IEND', Buffer.alloc(0))]);
}

/** Cabe a imagem na caixa `lado` x `altura-caixa` sem deformar (média de área, alfa pré-multiplicado) e centra num fundo transparente. */
export function caber({ largura, altura, rgba }, caixaL, caixaA) {
  const f = Math.min(caixaL / largura, caixaA / altura, 1);
  const nl = Math.max(1, Math.round(largura * f));
  const na = Math.max(1, Math.round(altura * f));
  const saida = new Uint8Array(caixaL * caixaA * 4);
  const ox = (caixaL - nl) >> 1;
  const oy = (caixaA - na) >> 1;
  for (let y = 0; y < na; y++) {
    for (let x = 0; x < nl; x++) {
      const x0 = Math.floor((x * largura) / nl);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * largura) / nl));
      const y0 = Math.floor((y * altura) / na);
      const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * altura) / na));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * largura + xx) * 4;
          const al = rgba[i + 3];
          r += rgba[i] * al;
          g += rgba[i + 1] * al;
          b += rgba[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = ((y + oy) * caixaL + x + ox) * 4;
      if (a > 0) saida.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a / n)], o);
    }
  }
  return { largura: caixaL, altura: caixaA, rgba: saida };
}

const hex2 = (n) => n.toString(16).padStart(2, '0');

/**
 * As `quantas` cores mais presentes: agrupa em 16 níveis por canal, ignora pixel quase transparente e junta cores
 * parecidas. Devolve [{ cor: '#rrggbb', parte }] com `parte` entre 0 e 1 sobre os pixels opacos.
 */
export function quantizar({ rgba }, quantas = 6, distanciaMinima = 48) {
  const baldes = new Map();
  let opacos = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue;
    opacos++;
    const k = ((rgba[i] >> 4) << 8) | ((rgba[i + 1] >> 4) << 4) | (rgba[i + 2] >> 4);
    const b = baldes.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
    b.n++;
    b.r += rgba[i];
    b.g += rgba[i + 1];
    b.b += rgba[i + 2];
    baldes.set(k, b);
  }
  const ordem = [...baldes.values()].sort((x, y) => y.n - x.n).map((b) => ({ n: b.n, c: [Math.round(b.r / b.n), Math.round(b.g / b.n), Math.round(b.b / b.n)] }));
  const escolhidas = [];
  for (const o of ordem) {
    const perto = escolhidas.find((e) => Math.hypot(e.c[0] - o.c[0], e.c[1] - o.c[1], e.c[2] - o.c[2]) < distanciaMinima);
    if (perto) perto.n += o.n;
    else if (escolhidas.length < quantas) escolhidas.push({ ...o });
  }
  return escolhidas.sort((x, y) => y.n - x.n).map((e) => ({ cor: `#${e.c.map(hex2).join('')}`, parte: opacos ? e.n / opacos : 0 }));
}
