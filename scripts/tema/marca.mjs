// Da marca (cores e fontes já escolhidas pelo modelo) ao tema candidato: parte do tema padrão, troca só o que a
// marca decide e grava em <home>/.expediente/host/temas/<id>/. Tudo que entra é dado: cor hexadecimal, texto curto
// e arquivo PNG; o resultado passa pelo schema antes de qualquer gravação.
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validar } from '../../shared/tema/validar.ts';
import { misturar } from './cor.mjs';
import { cadeiaSegura, pastaDosTemas, recusarSeEmUso } from './confinar.mjs';
import { caber, ehPng, gravarPng, lerPng, MAX_BYTES_ENTRADA } from './png.mjs';

export const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PADRAO = join(RAIZ, 'client/public/temas/padrao');
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const COR = /^#[0-9a-fA-F]{6}$/;
const CHAVES = { raiz: ['id', 'nome', 'cores', 'logo', 'tipografia', 'fontes', 'salas'], cores: ['primaria', 'secundaria', 'destaque', 'fundo', 'texto'] };

export function caminhoSeguro(valor, rotulo) {
  if (typeof valor !== 'string' || !valor || valor.length > 500) return `${rotulo}: caminho ausente ou longo demais`;
  if (/[\u0000-\u001f]/.test(valor)) return `${rotulo}: caminho com caractere de controle`;
  if (/^[a-z][a-z0-9+.-]*:/i.test(valor)) return `${rotulo}: URL ou esquema não cabe aqui, só caminho de arquivo local`;
  if (valor.split(/[\\/]/).includes('..')) return `${rotulo}: caminho com ".." recusado`;
  return null;
}

/** Lista de problemas da entrada (vazia = ok). Chave desconhecida conta: a entrada é só o que está na lista. */
export function conferirMarca(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return ['a marca precisa ser um objeto JSON'];
  const erros = [];
  for (const k of Object.keys(m)) if (!CHAVES.raiz.includes(k)) erros.push(`chave "${k}" não prevista`);
  if (typeof m.id !== 'string' || !ID.test(m.id)) erros.push('id: minúsculas, números e hífen, até 40 caracteres');
  else if (m.id === 'padrao') erros.push('id: "padrao" é reservado ao tema do repositório');
  const c = m.cores;
  if (!c || typeof c !== 'object' || Array.isArray(c)) erros.push('cores: objeto ausente');
  else {
    for (const k of Object.keys(c)) if (!CHAVES.cores.includes(k)) erros.push(`cores.${k}: chave não prevista`);
    for (const k of ['primaria', 'destaque']) if (!(k in c)) erros.push(`cores.${k}: obrigatória`);
    for (const [k, v] of Object.entries(c)) if (CHAVES.cores.includes(k) && (typeof v !== 'string' || !COR.test(v))) erros.push(`cores.${k}: ${JSON.stringify(v)} não é #rrggbb`);
  }
  if (m.logo !== undefined) {
    const e = caminhoSeguro(m.logo, 'logo');
    if (e) erros.push(e);
    else if (/\.svg$/i.test(m.logo)) erros.push('logo: SVG não é guardado; rasterize com "rasterizar" e passe o PNG');
    else if (!/\.png$/i.test(m.logo)) erros.push('logo: só PNG');
  }
  if (m.tipografia !== undefined) {
    const t = m.tipografia;
    if (!t || typeof t !== 'object' || Object.keys(t).some((k) => k !== 'equivalenteDe')) erros.push('tipografia: só aceita "equivalenteDe"');
  }
  if (!Array.isArray(m.fontes) || !m.fontes.length) erros.push('fontes: pelo menos uma fonte de informação registrada');
  return erros;
}

function lerLogo(caminho) {
  const st = lstatSync(caminho);
  if (!st.isFile()) throw new Error('logo: não é arquivo comum');
  if (st.size > MAX_BYTES_ENTRADA) throw new Error(`logo: ${st.size} bytes, o teto é ${MAX_BYTES_ENTRADA}`);
  const buf = readFileSync(caminho);
  if (!ehPng(buf)) throw new Error('logo: o conteúdo não é PNG');
  return lerPng(buf);
}

function sobre(base, topo, x0, y0) {
  for (let y = 0; y < topo.altura; y++) {
    for (let x = 0; x < topo.largura; x++) {
      const s = (y * topo.largura + x) * 4;
      const a = topo.rgba[s + 3] / 255;
      if (!a) continue;
      const d = ((y + y0) * base.largura + x + x0) * 4;
      for (let i = 0; i < 3; i++) base.rgba[d + i] = Math.round(topo.rgba[s + i] * a + base.rgba[d + i] * (1 - a));
    }
  }
}

function placaCom(logo, fundo, borda) {
  const cor = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const placa = { largura: 64, altura: 16, rgba: new Uint8Array(64 * 16 * 4) };
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 64; x++) placa.rgba.set([...cor(x === 0 || y === 0 || x === 63 || y === 15 ? borda : fundo), 255], (y * 64 + x) * 4);
  }
  sobre(placa, caber(logo, 12, 12), 3, 2);
  return placa;
}

export function temaDaMarca(m, padrao, hoje, nomeLogo) {
  const t = JSON.parse(JSON.stringify(padrao));
  const { primaria, destaque } = m.cores;
  const secundaria = m.cores.secundaria ?? destaque;
  t.id = m.id;
  t.nome = m.nome;
  const fontes = [...m.fontes.map((f) => ({ coletadoEm: hoje, ...f }))];
  if (nomeLogo) fontes.push({ tipo: 'imagem', referencia: nomeLogo, coletadoEm: hoje });
  t.origem = { tipo: 'marca', fontes };

  const { ui, canvas, marca, mundo } = t.paleta;
  const fundo = m.cores.fundo;
  const texto = m.cores.texto;
  if (fundo) {
    ui.fundo = `${fundo}eb`;
    ui.fundoSolido = `${fundo}f7`;
    canvas.rotuloFundo = `${fundo}e6`;
    canvas.rotuloContorno = `${fundo}a6`;
    canvas.compactoFundo = `${fundo}b3`;
  }
  if (texto) {
    const base = fundo ?? ui.fundoSolido.slice(0, 7);
    ui.texto = texto;
    ui.textoMudo = misturar(texto, base, 0.3);
    ui.textoFraco = misturar(texto, base, 0.45);
    ui.linha = `${texto}21`;
    ui.linhaForte = `${texto}3d`;
    canvas.rotuloTexto = texto;
    canvas.compactoTexto = texto;
  }
  ui.destaque = destaque;
  ui.destaqueSuave = `${destaque}21`;
  marca.letreiro = [marca.letreiro[0], marca.letreiro[1], primaria];
  marca.simbolo = [marca.simbolo[0], marca.simbolo[1], primaria, secundaria, destaque, marca.simbolo[5]];
  marca.estrela = secundaria;
  mundo.telhado = [misturar(primaria, '#000000', 0.55), misturar(primaria, '#000000', 0.4), misturar(primaria, '#000000', 0.48)];
  const cores = [primaria, secundaria, destaque];
  t.paleta.salas.forEach((s, i) => {
    const c = cores[i % 3];
    s.destaque = c;
    s.parede.friso = misturar(c, s.parede.base, 0.6);
    s.tapete = misturar(s.tapete, c, 0.12);
    s.tapete2 = misturar(s.tapete2, c, 0.12);
  });

  if (m.tipografia?.equivalenteDe) t.tipografia.equivalenteDe = m.tipografia.equivalenteDe;
  if (m.salas) t.textos.salas = m.salas;
  return t;
}

/**
 * Valida a marca e o tema montado e só então grava. `refazer` troca um candidato existente (a pasta `referencias` fica);
 * sem ele, uma pasta que já tem tema é recusada. Devolve a pasta.
 */
export function montar(m, { home, baseDir, hoje = new Date().toISOString().slice(0, 10), refazer = false }) {
  const erros = conferirMarca(m);
  if (erros.length) throw new Error(`marca recusada:\n- ${erros.join('\n- ')}`);
  recusarSeEmUso(home, m.id);
  const padrao = JSON.parse(readFileSync(join(PADRAO, 'tema.json'), 'utf8'));
  const esquema = JSON.parse(readFileSync(join(RAIZ, 'shared/tema/tema.schema.json'), 'utf8'));

  let logo = null;
  if (m.logo) logo = lerLogo(isAbsolute(m.logo) ? m.logo : resolve(baseDir, m.logo));
  const nomeLogo = m.logo ? basename(m.logo).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 100) : null;

  const tema = temaDaMarca(m, padrao, hoje, nomeLogo);
  const falhas = validar(esquema, tema);
  if (falhas.length) throw new Error(`o tema montado não passa no schema:\n- ${falhas.slice(0, 10).join('\n- ')}`);

  cadeiaSegura(home, m.id, 'referencias');
  const temas = pastaDosTemas(home);
  const destino = join(temas, m.id);
  const jaTem = existsSync(destino) && readdirSync(destino).some((n) => n !== 'referencias');
  if (jaTem && !refazer) throw new Error(`${destino} já tem um tema; use --refazer para substituir (a pasta referencias fica)`);

  mkdirSync(temas, { recursive: true });
  const novo = join(temas, `.${m.id}.novo`);
  rmSync(novo, { recursive: true, force: true });
  mkdirSync(novo);
  for (const d of ['art', 'brand', 'fontes']) cpSync(join(PADRAO, d), join(novo, d), { recursive: true });
  if (logo) {
    writeFileSync(join(novo, tema.decoracao.marca.logo.arquivo), gravarPng(caber(logo, 32, 32)));
    writeFileSync(join(novo, tema.decoracao.marca.placa.arquivo), gravarPng(placaCom(logo, m.cores.primaria, m.cores.secundaria ?? m.cores.destaque)));
  }
  writeFileSync(join(novo, 'tema.json'), `${JSON.stringify(tema, null, 2)}\n`);
  if (existsSync(join(destino, 'referencias'))) renameSync(join(destino, 'referencias'), join(novo, 'referencias'));
  rmSync(destino, { recursive: true, force: true });
  renameSync(novo, destino);
  return destino;
}
