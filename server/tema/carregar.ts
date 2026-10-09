// Tema ativo: lê no boot o tema escolhido em <hostDir>/tema-ativo (pasta <hostDir>/temas/<id>/) ou o padrão do repositório.
// Tema inválido, com contraste abaixo do mínimo ou sem os pares do padrão cai no padrão e devolve um aviso para a tela.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import schema from '../../shared/tema/tema.schema.json';
import { medirContraste, paresFaltando, validar, type Tema } from '../../shared/tema/validar';

export interface TemaCarregado {
  id: string;
  tema: Tema;
  /** Prefixo dos arquivos do tema no servidor (termina em '/'). */
  base: string;
  aviso?: string;
}

export interface PastasDoTema {
  /** ~/.expediente/host no host, /host no container (só leitura). */
  hostDir: string;
  /** Tema padrão do repositório (client/public/temas/padrao ou dist/client/temas/padrao). */
  padraoDir: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_JSON = 256 * 1024;
const PNG = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*)*\.png$/;

function lerJson(arquivo: string): unknown {
  if (statSync(arquivo).size > MAX_JSON) throw new Error('arquivo grande demais');
  return JSON.parse(readFileSync(arquivo, 'utf8'));
}

function pastaDe(p: PastasDoTema, id: string): string {
  return id === 'padrao' ? p.padraoDir : join(p.hostDir, 'temas', id);
}

function conferir(dado: unknown, padrao: Tema): string[] {
  const falhas = validar(schema, dado);
  if (falhas.length) return falhas;
  const tema = dado as Tema;
  const { erros } = medirContraste(tema);
  return [...erros, ...paresFaltando(tema, padrao)];
}

export function carregarTema(pastas: PastasDoTema): TemaCarregado {
  const padrao = lerJson(join(pastas.padraoDir, 'tema.json')) as Tema;
  const doPadrao = (aviso?: string): TemaCarregado => ({ id: 'padrao', tema: padrao, base: '/temas/padrao/', aviso });

  let id: string;
  try {
    id = readFileSync(join(pastas.hostDir, 'tema-ativo'), 'utf8').trim();
  } catch {
    return doPadrao();
  }
  if (!id || id === 'padrao') return doPadrao();
  if (!ID.test(id)) return doPadrao('Tema ativo ignorado: o nome em tema-ativo não é válido. Usando o tema padrão.');

  try {
    const dado = lerJson(join(pastaDe(pastas, id), 'tema.json'));
    const falhas = conferir(dado, padrao);
    if (falhas.length) return doPadrao(`Tema "${id}" ignorado (${falhas.length} problema(s), ex.: ${falhas[0]}). Usando o tema padrão.`);
    if ((dado as Tema).id !== id) return doPadrao(`Tema "${id}" ignorado: o id dentro do tema.json é outro. Usando o tema padrão.`);
    return { id, tema: dado as Tema, base: `/temas/${id}/` };
  } catch {
    return doPadrao(`Tema "${id}" ignorado: tema.json ausente ou ilegível. Usando o tema padrão.`);
  }
}

const TIPO: Record<string, string> = { '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

/**
 * Caminho absoluto de um arquivo do tema ativo, ou undefined. Só `.png` e a fonte declarada, e o arquivo real
 * (depois de seguir links) precisa estar dentro da pasta do tema.
 */
export function arquivoDoTema(pastas: PastasDoTema, ativo: TemaCarregado, id: string, rel: string): { caminho: string; tipo: string } | undefined {
  if (id !== ativo.id) return undefined;
  const fonte = ativo.tema.tipografia.arquivo;
  const ext = rel.slice(rel.lastIndexOf('.'));
  if (!(PNG.test(rel) || rel === fonte) || !TIPO[ext]) return undefined;
  try {
    const raiz = realpathSync(pastaDe(pastas, id));
    const real = realpathSync(join(raiz, rel));
    if (!real.startsWith(raiz + sep) || !statSync(real).isFile()) return undefined;
    return { caminho: real, tipo: TIPO[ext] };
  } catch {
    return undefined;
  }
}
