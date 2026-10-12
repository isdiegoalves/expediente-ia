// Guardar um arquivo do dono em referencias/: só PNG (regravado, sem blocos extras), CSS e HTML; nunca SVG nem pacote.
import { statSync } from 'node:fs';
import { ehPng, gravarPng, lerPng, MAX_BYTES_ENTRADA } from './png.mjs';

const MAX_TEXTO = 1024 * 1024;
const NOME = /^[a-z0-9][a-z0-9_-]{0,80}\.(png|css|html)$/;

export function nomeDeReferencia(nome) {
  const m = typeof nome === 'string' ? NOME.exec(nome) : null;
  if (!m) {
    if (/\.svg$/i.test(String(nome))) throw new Error('SVG não é guardado: rasterize com "rasterizar" ou peça um PNG ao dono');
    throw new Error('nome de arquivo inválido: minúsculas, números, "_" e "-", terminando em .png, .css ou .html, sem pasta');
  }
  return m[1];
}

/** O teto do tipo, conferido pelo tamanho no disco antes de qualquer leitura. */
export function tetoDe(tipo) {
  return tipo === 'png' ? MAX_BYTES_ENTRADA : MAX_TEXTO;
}

export function conferirTamanho(arquivo, tipo, rotulo) {
  if (statSync(arquivo).size > tetoDe(tipo)) throw new Error(`${rotulo}: acima de ${tetoDe(tipo)} bytes`);
}

/** O conteúdo que vai para o disco: o PNG regravado ou o texto como veio, depois de conferir que é o que o nome diz. */
export function conteudoParaGuardar(tipo, buf) {
  if (tipo === 'png') {
    if (!ehPng(buf)) throw new Error('o conteúdo não é PNG');
    return gravarPng(lerPng(buf));
  }
  if (ehPng(buf)) throw new Error(`o conteúdo é PNG, não ${tipo}`);
  let texto;
  try {
    texto = new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new Error(`o conteúdo não é texto UTF-8, não ${tipo}`);
  }
  if (texto.includes('\u0000')) throw new Error(`o conteúdo tem byte nulo, não é ${tipo}`);
  if (/<svg[\s>]/i.test(texto)) throw new Error('SVG não é guardado: rasterize com "rasterizar" ou peça um PNG ao dono');
  return buf;
}
