// Passagem única por onde sai tudo o que a tela mostra: segredos mascarados e caminho de projeto só com o nome da pasta.
import { maskSecrets } from '../../shared/activity';

const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function trocadorDeCaminhos(projects: ReadonlyMap<string, string>): ((s: string) => string) | undefined {
  const pares = [...projects].filter(([path]) => path.length > 1).sort((a, b) => b[0].length - a[0].length);
  if (!pares.length) return undefined;
  const nomes = new Map(pares);
  const re = new RegExp(`(?<![\\w.~/-])(?:${pares.map(([p]) => escapar(p)).join('|')})(?![\\w.-])`, 'g');
  return (s) => s.replace(re, (m) => nomes.get(m)!);
}

/**
 * Cópia de `value` com todo campo string mascarado por `maskSecrets` e cada caminho de projeto (`projects`:
 * caminho completo -> nome exibido) trocado pelo nome. Serve a qualquer resposta que leve dados de agente.
 */
export function sanitizeOutput<T>(value: T, projects: ReadonlyMap<string, string> = new Map()): T {
  const trocar = trocadorDeCaminhos(projects);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return maskSecrets(trocar ? trocar(v) : v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return walk(value) as T;
}
