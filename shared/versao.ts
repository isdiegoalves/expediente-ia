// Aviso de versão nova. Quem consulta o GitHub é o script do host (scripts/versao.ts), nunca o servidor: o
// servidor só lê o versao.json que ele grava na ponte e compara com a versão em uso.

export interface VersaoPublicada {
  /** Sem o "v" (1.2.0). */
  versao: string;
  publicadaEm: string;
  url: string;
}

export interface VersaoOrigem {
  nome: string;
  ultima: string;
  publicadaEm: string;
  url: string;
  analise?: string;
}

/** Resposta de GET /api/versao. */
export interface VersaoView {
  emUso: string;
  verificadoEm?: string;
  ultima?: VersaoPublicada;
  /** A última do Expediente é maior que a em uso. */
  nova: boolean;
  origem?: VersaoOrigem;
}

const SEMVER = /^v?(\d{1,9})\.(\d{1,9})\.(\d{1,9})$/;
const TEXTO_MAX = 120;
const URL_MAX = 300;

export function parseSemver(v: unknown): [number, number, number] | null {
  const m = typeof v === 'string' ? SEMVER.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** Negativo, zero ou positivo; null quando algum dos lados não é X.Y.Z. */
export function compararSemver(a: string, b: string): number | null {
  const x = parseSemver(a);
  const y = parseSemver(b);
  if (!x || !y) return null;
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

function textoCurto(v: unknown, max = TEXTO_MAX): string | null {
  return typeof v === 'string' && v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : null;
}

function data(v: unknown): string | null {
  const t = textoCurto(v, 40);
  return t && !Number.isNaN(Date.parse(t)) ? t : null;
}

function urlHttps(v: unknown): string | null {
  const t = textoCurto(v, URL_MAX);
  if (!t) return null;
  try {
    return new URL(t).protocol === 'https:' ? t : null;
  } catch {
    return null;
  }
}

const objeto = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function lerPublicada(v: unknown): VersaoPublicada | null {
  const o = objeto(v);
  const ultima = parseSemver(o?.ultima);
  const publicadaEm = data(o?.publicadaEm);
  const url = urlHttps(o?.url);
  if (!o || !ultima || !publicadaEm || !url) return null;
  return { versao: ultima.join('.'), publicadaEm, url };
}

function lerOrigem(v: unknown): VersaoOrigem | null {
  const o = objeto(v);
  const nome = textoCurto(o?.nome);
  const ultima = textoCurto(o?.ultima, 40);
  const publicadaEm = data(o?.publicadaEm);
  const url = urlHttps(o?.url);
  if (!o || !nome || !ultima || !publicadaEm || !url) return null;
  const analise = o.analise === undefined ? null : urlHttps(o.analise);
  return { nome, ultima, publicadaEm, url, ...(analise ? { analise } : {}) };
}

/**
 * Valida o conteúdo do versao.json e junta com a versão em uso. Cada bloco vale por si: o que vier torto
 * (ou de um formato que este código não conhece) é ignorado, nunca derruba.
 */
export function lerVersao(texto: string | null, emUso: string): VersaoView {
  let raiz: Record<string, unknown> | null = null;
  try {
    raiz = texto === null ? null : objeto(JSON.parse(texto));
  } catch {
    raiz = null;
  }
  const ultima = lerPublicada(raiz?.expediente) ?? undefined;
  const verificadoEm = data(raiz?.verificadoEm) ?? undefined;
  const origem = lerOrigem(raiz?.origem) ?? undefined;
  const cmp = ultima ? compararSemver(ultima.versao, emUso) : null;
  return { emUso, ...(verificadoEm ? { verificadoEm } : {}), ...(ultima ? { ultima } : {}), nova: cmp !== null && cmp > 0, ...(origem ? { origem } : {}) };
}
