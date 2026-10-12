// Toda gravação ou remoção dos scripts fica dentro de <home>/.expediente/host/temas/<id>/. Nenhum componente do
// caminho, de .expediente para baixo, pode ser link simbólico ou algo que não seja pasta.
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, writeSync } from 'node:fs';
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
}

export function gravarArquivoComum(destino, dados) {
  destinoGravavel(destino);
  const fd = openSync(destino, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try {
    if (!fstatSync(fd).isFile()) throw new Error(`${destino} não é arquivo comum; recusado`);
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
