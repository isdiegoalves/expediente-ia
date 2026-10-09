// Preços e janela de contexto por modelo. A tabela padrão (modelos.json) vem do catálogo embutido no Claude Code;
// o dono pode sobrescrever modelos em `precos.json`, na pasta da ponte com o host (~/.expediente/host).
import { readFileSync, statSync } from 'node:fs';
import { log } from '../log';
import padrao from './modelos.json';

/** USD por milhão de tokens. */
export interface Tarifa {
  entrada: number;
  saida: number;
  escritaCache5m: number;
  escritaCache1h: number;
  leituraCache: number;
  /** USD por busca na web (não por milhão). */
  busca: number;
}

export interface PrecoModelo extends Tarifa {
  janela?: number;
  /** Tarifa que vale quando o prompt da mensagem passa de `acimaDeTokens`. */
  longo?: Tarifa & { acimaDeTokens: number };
}

export interface TabelaModelos {
  janelaPadrao: number;
  janelaEstendida: number;
  modelos: Record<string, PrecoModelo>;
  apelidos: Record<string, string>;
}

/** Contagens de uma mensagem do assistente, já somadas por campo. */
export interface UsoBruto {
  entrada: number;
  saida: number;
  leituraCache: number;
  escritaCache: number;
  escritaCache1h: number;
  buscas: number;
  /** `inference_geo` da mensagem. */
  geo?: string;
}

const CAMPOS_TARIFA = ['entrada', 'saida', 'escritaCache5m', 'escritaCache1h', 'leituraCache', 'busca'] as const;
const VERIFICA_DONO_A_CADA_MS = 5_000;
// Mesmo acréscimo que o Claude Code aplica ao processamento nos EUA (inference_geo "us").
const ACRESCIMO_GEO_US = 1.1;

function ehNumero(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

function tarifaValida(v: unknown): v is Tarifa {
  return !!v && typeof v === 'object' && CAMPOS_TARIFA.every((c) => ehNumero((v as Record<string, unknown>)[c]));
}

function precoValido(v: unknown): v is PrecoModelo {
  if (!tarifaValida(v)) return false;
  const { janela, longo } = v as { janela?: unknown; longo?: unknown };
  if (janela !== undefined && !ehNumero(janela)) return false;
  return longo === undefined || (tarifaValida(longo) && ehNumero((longo as { acimaDeTokens?: unknown }).acimaDeTokens));
}

function clone(t: TabelaModelos): TabelaModelos {
  return { ...t, modelos: { ...t.modelos }, apelidos: { ...t.apelidos } };
}

/** Aplica o arquivo do dono sobre a tabela: campos do modelo se somam aos do padrão; entrada inválida é ignorada. */
export function mesclarTabela(base: TabelaModelos, dono: unknown, origem = 'precos.json'): TabelaModelos {
  const t = clone(base);
  if (!dono || typeof dono !== 'object' || Array.isArray(dono)) return t;
  const d = dono as Record<string, unknown>;
  for (const k of ['janelaPadrao', 'janelaEstendida'] as const) if (ehNumero(d[k]) && d[k] > 0) t[k] = d[k] as number;
  if (d.apelidos && typeof d.apelidos === 'object') {
    for (const [de, para] of Object.entries(d.apelidos)) if (typeof para === 'string') t.apelidos[de] = para;
  }
  if (d.modelos && typeof d.modelos === 'object') {
    for (const [id, v] of Object.entries(d.modelos)) {
      const merged = { ...(t.modelos[id] ?? {}), ...(v as object) };
      if (precoValido(merged)) t.modelos[id] = merged;
      else log.warnOnce(`precos:${origem}:${id}`, `${origem}: o modelo "${id.slice(0, 80)}" está incompleto ou inválido e foi ignorado.`);
    }
  }
  return t;
}

const TABELA_PADRAO = padrao as unknown as TabelaModelos;

let arquivoDoDono: string | undefined;
let verificadoEm = 0;
let assinatura = '';
let ativa: TabelaModelos = TABELA_PADRAO;

/** Passa a ler `precos.json` do dono (relido quando muda); sem argumento, volta só à tabela padrão. */
export function usarArquivoDoDono(arquivo?: string): void {
  arquivoDoDono = arquivo;
  verificadoEm = 0;
  assinatura = '';
  ativa = TABELA_PADRAO;
}

export function tabelaAtual(agora = Date.now()): TabelaModelos {
  if (!arquivoDoDono || agora - verificadoEm < VERIFICA_DONO_A_CADA_MS) return ativa;
  verificadoEm = agora;
  try {
    const st = statSync(arquivoDoDono);
    const sig = `${st.mtimeMs}:${st.size}`;
    if (sig === assinatura) return ativa;
    assinatura = sig;
    ativa = mesclarTabela(TABELA_PADRAO, JSON.parse(readFileSync(arquivoDoDono, 'utf8')), 'precos.json');
    log.clearOnce('precos:leitura');
  } catch (err) {
    const ausente = (err as { code?: string }).code === 'ENOENT';
    assinatura = '';
    ativa = TABELA_PADRAO;
    if (!ausente) log.warnOnce('precos:leitura', 'precos.json do dono ilegível: valem só os preços padrão.');
  }
  return ativa;
}

/** Id da tabela para o nome do modelo no transcript: apelido, sem sufixo de data e sem "[1m]". */
function resolver(t: TabelaModelos, modelo: string): string | undefined {
  const base = modelo.trim().toLowerCase().replace(/\[1m\]$/, '');
  for (const c of [base, t.apelidos[base], base.replace(/-\d{8}$/, '')]) if (c && Object.hasOwn(t.modelos, c)) return c;
  return undefined;
}

export function precoDoModelo(modelo: string): PrecoModelo | undefined {
  const t = tabelaAtual();
  const id = resolver(t, modelo);
  return id ? t.modelos[id] : undefined;
}

function custoDe(t: Tarifa, u: UsoBruto): number {
  const de1h = Math.min(u.escritaCache1h, u.escritaCache);
  const escrita = (de1h / 1e6) * t.escritaCache1h + ((u.escritaCache - de1h) / 1e6) * t.escritaCache5m;
  const base = (u.entrada / 1e6) * t.entrada + (u.saida / 1e6) * t.saida + (u.leituraCache / 1e6) * t.leituraCache + escrita;
  return base * (u.geo === 'us' ? ACRESCIMO_GEO_US : 1) + u.buscas * t.busca;
}

/** Custo em USD de uma mensagem, ou undefined quando a tabela não tem o modelo. */
export function custoDaMensagem(modelo: string, u: UsoBruto): number | undefined {
  const p = precoDoModelo(modelo);
  if (!p) return undefined;
  const prompt = u.entrada + u.leituraCache + u.escritaCache;
  return custoDe(p.longo && prompt > p.longo.acimaDeTokens ? p.longo : p, u);
}

/**
 * Janela de contexto do modelo. Modelo `claude-*` fora da tabela usa a janela padrão; modelo de outra origem
 * não tem janela conhecida. O nome no transcript não traz o sufixo "[1m]": contexto acima da janela da tabela
 * só cabe na janela estendida.
 */
export function janelaDoModelo(modelo: string, contexto: number): number | undefined {
  const t = tabelaAtual();
  const id = resolver(t, modelo);
  const janela = (id && t.modelos[id].janela) || (modelo.toLowerCase().startsWith('claude-') ? t.janelaPadrao : undefined);
  if (janela === undefined) return undefined;
  return contexto > janela ? Math.max(janela, t.janelaEstendida) : janela;
}
