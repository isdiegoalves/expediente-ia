// Tema ativo do cliente: começa no padrão empacotado e troca pelo do servidor (GET /api/tema) antes de o mundo e a
// UI serem importados, então os módulos que leem o tema no import já veem o definitivo.
import esquema from '../../../shared/tema/tema.schema.json';
import { medirContraste, validar, type Tema } from '../../../shared/tema/validar';
import padraoJson from '../../public/temas/padrao/tema.json';

export const TEMA_PADRAO = padraoJson as unknown as Tema;

const BASE = /^\/temas\/[a-z0-9][a-z0-9-]{0,39}\/$/;

let ativo: Tema = TEMA_PADRAO;
let base = '/temas/padrao/';

export function tema(): Tema {
  return ativo;
}

/** URL de um arquivo do tema ativo (PNG ou fonte). */
export function urlDoTema(arquivo: string): string {
  return base + arquivo;
}

export function definirTema(t: Tema, b: string): void {
  ativo = t;
  base = b;
}

/** Problemas do tema (schema e contraste); vazio = pode ser aplicado. */
export function problemasDoTema(t: unknown): string[] {
  const falhas = validar(esquema, t);
  return falhas.length ? falhas : medirContraste(t as Tema).erros;
}

/** Busca o tema no servidor e o define. Sem servidor ou com tema que não passa, segue no padrão. */
export async function carregarTema(): Promise<{ aviso?: string }> {
  try {
    const res = await fetch('/api/tema', { cache: 'no-store' });
    if (!res.ok) return {};
    const corpo = (await res.json()) as { base?: unknown; tema?: unknown; aviso?: unknown };
    const aviso = typeof corpo.aviso === 'string' ? corpo.aviso : undefined;
    if (typeof corpo.base !== 'string' || !BASE.test(corpo.base)) return { aviso };
    const problemas = problemasDoTema(corpo.tema);
    if (problemas.length) return { aviso: `Tema do servidor recusado pelo navegador (${problemas[0]}). Usando o padrão.` };
    definirTema(corpo.tema as Tema, corpo.base);
    return { aviso };
  } catch {
    return {};
  }
}
