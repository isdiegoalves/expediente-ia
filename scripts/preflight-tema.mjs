#!/usr/bin/env node
// Pré-voo do tema: schema, contraste com alpha composto, PNG e fonte, quadros iguais ao manifesto herdado e
// zero literal de cor nos arquivos do critério.
// Uso: node scripts/preflight-tema.mjs [pasta-do-tema]   (sem argumento confere o tema padrão do repositório)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { medirContraste, paresFaltando, validar } from '../shared/tema/validar.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PADRAO = join(RAIZ, 'client/public/temas/padrao');
const pasta = resolve(process.argv[2] ?? PADRAO);

const MAX_PNG = 256 * 1024;
const MAX_LADO = 512;
const MAX_TOTAL = 4 * 1024 * 1024;

const ARQUIVOS_COM_COR = [
  'client/src/ui/styles.css',
  'client/src/art/theme.ts',
  'client/src/world/render/overlay.ts',
  'client/src/world/layout/core.ts',
  'client/src/art/surfaces/floor.ts',
  'client/src/world/render/renderer.ts',
  'client/src/ui/icons.ts',
];
const LITERAL_DE_COR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g;
const LITERAIS_SAO_ERRO = true;

const erros = [];
const avisos = [];
const info = [];

const json = (arquivo) => JSON.parse(readFileSync(arquivo, 'utf8'));

function pngInfo(arquivo) {
  const b = readFileSync(arquivo);
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { largura: b.readUInt32BE(16), altura: b.readUInt32BE(20), bytes: b.length };
}

function conferirPng(rel, esperado, ctx) {
  const arquivo = join(pasta, rel);
  if (!existsSync(arquivo)) {
    erros.push(`${ctx}: falta o arquivo ${rel}`);
    return 0;
  }
  const p = pngInfo(arquivo);
  if (!p) {
    erros.push(`${ctx}: ${rel} não é PNG`);
    return 0;
  }
  if (p.bytes > MAX_PNG) erros.push(`${ctx}: ${rel} tem ${p.bytes} bytes, o máximo é ${MAX_PNG}`);
  if (p.largura > MAX_LADO || p.altura > MAX_LADO) erros.push(`${ctx}: ${rel} tem ${p.largura}x${p.altura}, o máximo é ${MAX_LADO}px por lado`);
  if (esperado && (p.largura !== esperado.largura || p.altura !== esperado.altura)) erros.push(`${ctx}: ${rel} tem ${p.largura}x${p.altura} e o tema declara ${esperado.largura}x${esperado.altura}`);
  return p.bytes;
}

let tema;
try {
  tema = json(join(pasta, 'tema.json'));
} catch (e) {
  console.log(`ERRO: ${join(pasta, 'tema.json')} ilegível (${e.message})\n\nPRÉ-VOO DO TEMA VERMELHO`);
  process.exit(1);
}
const esquema = json(join(RAIZ, 'shared/tema/tema.schema.json'));
const padrao = json(join(PADRAO, 'tema.json'));

const falhas = validar(esquema, tema);
for (const f of falhas) erros.push(`schema: ${f}`);
info.push(`schema: ${falhas.length} falha(s)`);

if (!falhas.length) {
  const { medidas, erros: errosContraste } = medirContraste(tema);
  erros.push(...errosContraste);
  const menor = medidas.reduce((a, m) => (m.razao / m.min < a.razao / a.min ? m : a), medidas[0]);
  info.push(`contraste: ${medidas.length} pares com alpha composto, o mais justo ${menor.razao.toFixed(2)}:1, mínimo ${menor.min} (${menor.par})`);
  erros.push(...paresFaltando(tema, padrao));

  let total = 0;
  const { logo, placa } = tema.decoracao.marca;
  total += conferirPng(logo.arquivo, logo, 'logo');
  total += conferirPng(placa.arquivo, placa, 'placa');
  for (const q of tema.decoracao.quadros) {
    total += conferirPng(q.arquivo, null, `quadro ${q.id}`);
    if (q.moldura) total += conferirPng(q.moldura.arquivo, q.moldura, `moldura de ${q.id}`);
  }
  if (total > MAX_TOTAL) erros.push(`PNG somam ${total} bytes, o máximo é ${MAX_TOTAL}`);
  info.push(`png: ${2 + tema.decoracao.quadros.length} imagens (+ molduras), ${total} bytes`);

  const fonte = join(pasta, tema.tipografia.arquivo);
  if (!existsSync(fonte) || !statSync(fonte).isFile()) erros.push(`tipografia: falta o arquivo ${tema.tipografia.arquivo}`);
  info.push(`fonte: ${tema.tipografia.familia} (${tema.tipografia.licenca})`);

  if (tema.id === 'padrao') {
    const manifesto = json(join(RAIZ, 'client/public/assets/manifest.json'));
    const nossos = new Map(tema.decoracao.quadros.map((q) => [q.id, q]));
    for (const m of manifesto.wallArt) {
      const q = nossos.get(m.id);
      if (!q) {
        erros.push(`quadros: ${m.id} do manifesto herdado está ausente do tema`);
        continue;
      }
      if (q.tiles !== m.tiles) erros.push(`quadros: ${m.id} com tiles ${q.tiles}, o manifesto diz ${m.tiles}`);
      if (!!q.moldura !== !!m.framed) erros.push(`quadros: ${m.id} ${m.framed ? 'perdeu' : 'ganhou'} a moldura`);
      else if (m.framed && (q.moldura.largura !== m.framed.w || q.moldura.altura !== m.framed.h)) erros.push(`quadros: moldura de ${m.id} com tamanho diferente do manifesto`);
      if ((q.variante ?? null) !== (m.variant ?? null)) erros.push(`quadros: ${m.id} com variante ${q.variante ?? 'nenhuma'}, o manifesto diz ${m.variant ?? 'nenhuma'}`);
    }
    info.push(`quadros: ${nossos.size} no tema, ${manifesto.wallArt.length} no manifesto herdado`);
  }
}

let literais = 0;
const porArquivo = [];
for (const rel of ARQUIVOS_COM_COR) {
  const n = (readFileSync(join(RAIZ, rel), 'utf8').match(LITERAL_DE_COR) ?? []).length;
  literais += n;
  if (n) porArquivo.push(`${rel}: ${n}`);
}
info.push(`literais de cor nos ${ARQUIVOS_COM_COR.length} arquivos do critério: ${literais}`);
if (literais) (LITERAIS_SAO_ERRO ? erros : avisos).push(`literal de cor restante (${porArquivo.join('; ')})`);

console.log(info.map((l) => `· ${l}`).join('\n'));
if (avisos.length) console.log(`\nAVISOS (${avisos.length})\n${avisos.map((l) => `! ${l}`).join('\n')}`);
if (erros.length) console.log(`\nERROS (${erros.length})\n${erros.map((l) => `✗ ${l}`).join('\n')}`);
console.log(erros.length ? '\nPRÉ-VOO DO TEMA VERMELHO' : '\nPRÉ-VOO DO TEMA VERDE');
process.exit(erros.length ? 1 : 0);
