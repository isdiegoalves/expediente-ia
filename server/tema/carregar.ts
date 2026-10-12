// Temas do servidor: o ativo, escolhido em <hostDir>/tema-ativo (pasta <hostDir>/temas/<id>/), e os candidatos que uma
// aba pede para ver em prévia. O tema inválido, com contraste abaixo do mínimo ou sem os pares do padrão não vale:
// o ativo cai no padrão e a prévia é recusada, ambos com um aviso para a tela.
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import schema from '../../shared/tema/tema.schema.json';
import { medirContraste, paresFaltando, validar, type Tema } from '../../shared/tema/validar';

export interface TemaCarregado {
  id: string;
  tema: Tema;
  /** Prefixo dos arquivos do tema no servidor (termina em '/'). */
  base: string;
  aviso?: string;
  /** Candidato visto em prévia numa aba: o tema ativo do escritório não mudou. */
  previa?: boolean;
}

export interface PastasDoTema {
  /** ~/.expediente/host no host, /host no container (só leitura). */
  hostDir: string;
  /** Tema padrão do repositório (client/public/temas/padrao ou dist/client/temas/padrao). */
  padraoDir: string;
}

const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_JSON = 256 * 1024;
const MAX_NOME = 256;
const NOME_INVALIDO = 'Tema ativo ignorado: o nome em tema-ativo não é válido. Usando o tema padrão.';

function lerJson(arquivo: string): unknown {
  const st = lstatSync(arquivo);
  if (!st.isFile() || st.size > MAX_JSON) throw new Error('arquivo inválido');
  return JSON.parse(readFileSync(arquivo, 'utf8'));
}

const lerPadrao = (p: PastasDoTema): Tema => lerJson(join(p.padraoDir, 'tema.json')) as Tema;

/** A pasta do tema, ou undefined se não existe, não é pasta comum de temas/ (link simbólico incluso) ou o id não serve. */
function pastaDoTema(p: PastasDoTema, id: string): string | undefined {
  if (id === 'padrao') return p.padraoDir;
  if (!ID.test(id)) return undefined;
  const pasta = join(p.hostDir, 'temas', id);
  try {
    return realpathSync(pasta) === join(realpathSync(join(p.hostDir, 'temas')), id) ? pasta : undefined;
  } catch {
    return undefined;
  }
}

function conferir(dado: unknown, padrao: Tema): string[] {
  const falhas = validar(schema, dado);
  if (falhas.length) return falhas;
  const tema = dado as Tema;
  const { erros } = medirContraste(tema);
  return [...erros, ...paresFaltando(tema, padrao)];
}

/** Abre e confere o tema de uma pasta com a mesma conferência para o ativo e para a prévia. */
function abrirTema(pastas: PastasDoTema, id: string, padrao: Tema): { tema: TemaCarregado } | { motivo: string } {
  const pasta = pastaDoTema(pastas, id);
  if (!pasta) return { motivo: 'pasta do tema ausente (ou link simbólico)' };
  let dado: unknown;
  try {
    dado = lerJson(join(pasta, 'tema.json'));
  } catch {
    return { motivo: 'tema.json ausente ou ilegível' };
  }
  const falhas = conferir(dado, padrao);
  if (falhas.length) return { motivo: `${falhas.length} problema(s), ex.: ${falhas[0]}` };
  if ((dado as Tema).id !== id) return { motivo: 'o id dentro do tema.json é outro' };
  return { tema: { id, tema: dado as Tema, base: `/temas/${id}/` } };
}

/** O nome em tema-ativo: undefined se o arquivo não existe, null se não é um arquivo comum pequeno. */
function lerNomeAtivo(hostDir: string): string | null | undefined {
  const arquivo = join(hostDir, 'tema-ativo');
  try {
    const st = statSync(arquivo);
    return st.isFile() && st.size <= MAX_NOME ? readFileSync(arquivo, 'utf8').trim() : null;
  } catch {
    return undefined;
  }
}

export function carregarTema(pastas: PastasDoTema): TemaCarregado {
  const padrao = lerPadrao(pastas);
  const doPadrao = (aviso?: string): TemaCarregado => ({ id: 'padrao', tema: padrao, base: '/temas/padrao/', aviso });

  const nome = lerNomeAtivo(pastas.hostDir);
  if (nome === null) return doPadrao(NOME_INVALIDO);
  if (!nome || nome === 'padrao') return doPadrao();
  if (!ID.test(nome)) return doPadrao(NOME_INVALIDO);

  const r = abrirTema(pastas, nome, padrao);
  return 'tema' in r ? r.tema : doPadrao(`Tema "${nome}" ignorado: ${r.motivo}. Usando o tema padrão.`);
}

/** Muda quando tema-ativo ou o tema.json do tema ativo muda: lê um arquivo pequeno e faz um stat. */
export function assinaturaDoTema(pastas: PastasDoTema): string {
  const nome = lerNomeAtivo(pastas.hostDir);
  if (!nome || nome === 'padrao' || !ID.test(nome)) return String(nome);
  try {
    const st = statSync(join(pastas.hostDir, 'temas', nome, 'tema.json'));
    return `${nome}|${st.mtimeMs}|${st.size}`;
  } catch {
    return `${nome}|ausente`;
  }
}

/**
 * Prévia de um candidato numa aba: o tema, conferido como o ativo e marcado como prévia, ou o próprio tema ativo com um
 * aviso do motivo. Não grava nada nem muda o tema ativo.
 */
export function previaDoTema(pastas: PastasDoTema, ativo: TemaCarregado, pedido: string): TemaCarregado {
  const recusa = (motivo: string): TemaCarregado => ({ ...ativo, aviso: [`Prévia recusada: ${motivo}. Seguindo no tema ativo.`, ativo.aviso].filter(Boolean).join(' ') });
  if (!ID.test(pedido)) return recusa('o nome do tema não é válido');
  if (pedido === ativo.id) return ativo;
  const r = abrirTema(pastas, pedido, lerPadrao(pastas));
  return 'tema' in r ? { ...r.tema, previa: true } : recusa(`tema "${pedido}": ${r.motivo}`);
}

/** Identifica o estado do tema ativo para a página saber se o que ela carregou ainda vale. */
export const chaveDoTema = (t: TemaCarregado): string => `${t.id}|${t.aviso ?? ''}`;

const TIPO: Record<string, string> = { '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

/** Os arquivos que o tema.json declara: a marca, os quadros (com a moldura) e a fonte. */
function declarados(t: Tema): Set<string> {
  const { logo, placa } = t.decoracao.marca;
  return new Set([logo.arquivo, placa.arquivo, t.tipografia.arquivo, ...t.decoracao.quadros.flatMap((q) => (q.moldura ? [q.arquivo, q.moldura.arquivo] : [q.arquivo]))]);
}

/**
 * Caminho absoluto de um arquivo que o tema `id` declara, ou undefined. Atende o tema ativo e os candidatos que passam
 * na mesma conferência. Só arquivo comum (link simbólico não vale) dentro da pasta real do tema.
 */
export function arquivoDoTema(pastas: PastasDoTema, ativo: TemaCarregado, id: string, rel: string): { caminho: string; tipo: string } | undefined {
  let doTema: Tema | undefined;
  if (id === ativo.id) doTema = ativo.tema;
  else if (ID.test(id)) {
    const r = abrirTema(pastas, id, lerPadrao(pastas));
    if ('tema' in r) doTema = r.tema.tema;
  }
  const tipo = TIPO[rel.slice(rel.lastIndexOf('.'))];
  const pasta = pastaDoTema(pastas, id);
  if (!doTema || !tipo || !pasta || !declarados(doTema).has(rel)) return undefined;
  try {
    const raiz = realpathSync(pasta);
    const alvo = join(raiz, rel);
    if (!lstatSync(alvo).isFile()) return undefined;
    const real = realpathSync(alvo);
    return real.startsWith(raiz + sep) ? { caminho: real, tipo } : undefined;
  } catch {
    return undefined;
  }
}
