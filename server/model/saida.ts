// Passagem única por onde sai tudo o que a tela mostra: segredos mascarados e caminho de projeto só com o nome da pasta.
import { maskSecrets } from '../../shared/activity';

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Dentro do JSON cru uma quebra de linha antes do caminho aparece como `\n`.
const ANTES = String.raw`(?:(?<![\w.~/-])|(?<=\\[nrt]))`;

/** Troca cada caminho completo (caminho -> nome) por seu nome; o mais longo primeiro. */
export function trocadorDeCaminhos(projects: ReadonlyMap<string, string>): ((s: string) => string) | undefined {
  const pares = [...projects].filter(([path]) => path.length > 1).sort((a, b) => b[0].length - a[0].length);
  if (!pares.length) return undefined;
  const nomes = new Map(pares);
  const re = new RegExp(`${ANTES}(?:${pares.map(([p]) => escapar(p)).join('|')})(?![\\w.-])`, 'g');
  return (s) => s.replace(re, (m) => nomes.get(m)!);
}

const PASTA_DO_USUARIO = /(?<![\w.~/-])\/(?:Users|home)\/[^/\s'"…]+\//g;
const PASTA_DO_USUARIO_CORTADA = /(?<![\w.~/-])\/(?:Users|home)(?:\/[^/\s'"…]*)?…/g;

/** Texto cortado com reticências no meio de um caminho de projeto: tira o pedaço do caminho que sobrou. */
function semPrefixoCortado(s: string, paths: Iterable<string>): string {
  if (!s.endsWith('…')) return s;
  const corpo = s.slice(0, -1);
  for (const path of paths) {
    for (let k = Math.min(path.length - 1, corpo.length); k >= 2; k--) {
      if (!corpo.endsWith(path.slice(0, k))) continue;
      if (!/[\w.~/-]/.test(corpo[corpo.length - k - 1] ?? ' ')) return `${corpo.slice(0, corpo.length - k)}…`;
    }
  }
  return s;
}

/**
 * Cópia de `value` com todo campo string mascarado por `maskSecrets` e, salvo `trocarCaminhos: false`, cada
 * caminho de projeto (`projects`: caminho completo -> nome exibido) trocado pelo nome e a pasta do usuário
 * (`/Users/<nome>/`) por `~/`. Serve a qualquer resposta que leve dados de agente.
 */
export function sanitizeOutput<T>(value: T, projects: ReadonlyMap<string, string> = new Map(), opts: { trocarCaminhos?: boolean } = {}): T {
  const caminhos = opts.trocarCaminhos === false ? undefined : projects;
  const trocar = caminhos && trocadorDeCaminhos(caminhos);
  const limpar = (s: string): string => {
    if (!caminhos) return maskSecrets(s);
    const t = semPrefixoCortado(trocar ? trocar(s) : s, caminhos.keys());
    return maskSecrets(t.replace(PASTA_DO_USUARIO, '~/').replace(PASTA_DO_USUARIO_CORTADA, '~…'));
  };
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return limpar(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
