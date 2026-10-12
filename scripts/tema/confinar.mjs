// Toda gravação ou remoção dos scripts fica dentro de <home>/.expediente/host/temas/<id>/ (e o tema-ativo ao lado de
// temas/). Nenhum componente do caminho, de .expediente para baixo, pode ser link simbólico ou algo que não seja pasta.
import { closeSync, constants, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readFileSync, writeSync } from 'node:fs';
import { join } from 'node:path';

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const NOME_PNG = /^[a-z0-9][a-z0-9_-]{0,80}\.png$/;

export const pastaDosTemas = (home) => join(home, '.expediente', 'host', 'temas');

export function idValido(id) {
  if (!ID.test(id ?? '') || id === 'padrao') throw new Error('id de tema inválido: minúsculas, números e hífen (e não "padrao")');
  return id;
}

export function nomePng(nome) {
  if (typeof nome !== 'string' || !NOME_PNG.test(nome)) throw new Error('nome de arquivo inválido: minúsculas, números, "_" e "-", terminando em .png, sem pasta');
  return nome;
}

/** Recusa se algum componente existente de `.expediente` até o último de `partes` é link simbólico ou não é pasta. */
export function cadeiaSegura(home, ...partes) {
  let atual = home;
  for (const p of ['.expediente', 'host', 'temas', ...partes]) {
    atual = join(atual, p);
    let st;
    try {
      st = lstatSync(atual);
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    if (st.isSymbolicLink()) throw new Error(`${atual} é link simbólico; recusado`);
    if (!st.isDirectory()) throw new Error(`${atual} não é pasta; recusado`);
  }
}

export function criarPasta(home, ...partes) {
  cadeiaSegura(home, ...partes);
  const alvo = join(pastaDosTemas(home), ...partes);
  mkdirSync(alvo, { recursive: true });
  return alvo;
}

/** O destino não existe ou é arquivo comum; link simbólico e qualquer outra coisa são recusados. */
export function destinoGravavel(destino) {
  let st = null;
  try {
    st = lstatSync(destino);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  if (st && st.isSymbolicLink()) throw new Error(`${destino} é link simbólico; recusado`);
  if (st && !st.isFile()) throw new Error(`${destino} não é arquivo comum; recusado`);
  if (st && st.nlink > 1) throw new Error(`${destino} tem mais de um nome (hard link); recusado`);
}

export function gravarArquivoComum(destino, dados) {
  destinoGravavel(destino);
  const fd = openSync(destino, constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) throw new Error(`${destino} não é arquivo comum; recusado`);
    if (st.nlink > 1) throw new Error(`${destino} tem mais de um nome (hard link); recusado`);
    ftruncateSync(fd, 0);
    writeSync(fd, dados);
  } finally {
    closeSync(fd);
  }
}

/** Para ler de qualquer pasta, mas só arquivo comum: link simbólico, dispositivo e pasta são recusados. */
export function arquivoComumParaLer(caminho, rotulo = 'arquivo') {
  const st = lstatSync(caminho);
  if (!st.isFile()) throw new Error(`${rotulo}: ${caminho} não é arquivo comum (link simbólico, pasta ou dispositivo)`);
  return caminho;
}

/** Grava `id` (um id de tema ou "padrao") em <home>/.expediente/host/tema-ativo, que é onde o servidor lê o tema ativo. */
export function gravarTemaAtivo(home, id) {
  cadeiaSegura(home);
  const host = join(home, '.expediente', 'host');
  mkdirSync(host, { recursive: true });
  const destino = join(host, 'tema-ativo');
  gravarArquivoComum(destino, `${id}\n`);
  return destino;
}

/** O que está em tema-ativo, ou undefined (sem arquivo, que não seja arquivo comum, ou grande demais). */
export function lerTemaAtivo(home) {
  const destino = join(home, '.expediente', 'host', 'tema-ativo');
  try {
    const st = lstatSync(destino);
    return st.isFile() && st.size <= 256 ? readFileSync(destino, 'utf8').trim() : undefined;
  } catch {
    return undefined;
  }
}

/** Recusa mexer num tema que está em tema-ativo: o servidor lê o disco a cada pedido e a troca seria imediata, sem prévia. */
export function recusarSeEmUso(home, id) {
  if (lerTemaAtivo(home) === id) {
    throw new Error(`o tema "${id}" é o que está em uso no escritório; volte ao padrão com "tema.mjs padrao" ou use outro id para o candidato`);
  }
}
