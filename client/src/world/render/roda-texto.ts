// Roda da equipe em espaço de tela: a placa com a contagem por estado junto da roda e, com um clique, a lista de quem
// está nela (o nome leva ao subagente). A disposição é pura; o desenho segue o das pílulas e balões do overlay.
import { coresDerivadas } from '../../tema/cores';
import { tema } from '../../tema';
import { estadoNaRoda, type EstadoNaRoda, type RodaDaSala } from '../sim/fanout';
import type { Caixa } from './disposicao';

const UI_FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif';
const PLACA_FONT = `700 10.5px ${UI_FONT}`;
export const NOME_FONT = `600 10.5px ${UI_FONT}`;
const TITULO_FONT = `700 11.5px ${UI_FONT}`;
const SECAO_FONT = `700 9.5px ${UI_FONT}`;

export const PLACA_H = 18;
const PAD = 8;
const LINHA_H = 15;
const SECAO_H = 16;
const TITULO_H = 20;
const GAP_NOME = 10;
/** Linhas de nomes por estado antes do "e mais N". */
const MAX_LINHAS = 3;
export const LISTA_W = 300;
/** Largura útil dos nomes dentro da lista. */
export const LISTA_NOMES_W = LISTA_W - 2 * PAD;

const ESTADOS: readonly EstadoNaRoda[] = ['esperando', 'trabalhando', 'aToa', 'concluido'];

export interface PecaDaPlaca {
  texto: string;
  /** Bolinha na cor do estado antes do texto. */
  estado?: EstadoNaRoda;
  /** Fundo de alerta (quem espera você). */
  alerta?: boolean;
}

/** Placa: o total na roda e a contagem de cada estado presente; compacta = só os números. */
export function pecasDaPlaca(r: RodaDaSala, compacta: boolean): PecaDaPlaca[] {
  const out: PecaDaPlaca[] = [{ texto: `👥 ${r.membros.length}` }];
  if (r.esperando) out.push({ texto: `✋ ${r.esperando}`, alerta: true });
  if (r.trabalhando) out.push({ texto: compacta ? String(r.trabalhando) : `${r.trabalhando} trabalhando`, estado: 'trabalhando' });
  if (r.aToa) out.push({ texto: compacta ? String(r.aToa) : `${r.aToa} à toa`, estado: 'aToa' });
  if (r.concluido) out.push({ texto: compacta ? String(r.concluido) : `${r.concluido} ${r.concluido === 1 ? 'concluído' : 'concluídos'}`, estado: 'concluido' });
  return out;
}

export function tituloDaRoda(r: RodaDaSala, nomeDoPai: (id: string) => string | undefined): string {
  const pai = r.parentId ? nomeDoPai(r.parentId) : undefined;
  const quem = r.time ? `Time ${r.time}` : pai ? `Subagentes de ${pai}` : 'Subagentes da sala';
  return `${quem} · ${r.membros.length} na roda`;
}

export function tituloDaSecao(estado: EstadoNaRoda, n: number): string {
  const um = n === 1;
  const nome = estado === 'esperando' ? (um ? '✋ Espera você' : '✋ Esperam você') : estado === 'trabalhando' ? 'Trabalhando' : estado === 'aToa' ? 'À toa' : um ? 'Concluído' : 'Concluídos';
  return `${nome} · ${n}`;
}

export interface ItemDaLista {
  /** Subagente; ausente no "e mais N". */
  id?: string;
  texto: string;
  /** x a partir da margem interna da lista. */
  x: number;
  w: number;
}

export type LinhaDaLista = { tipo: 'secao'; estado: EstadoNaRoda; texto: string } | { tipo: 'nomes'; itens: ItemDaLista[] };

/**
 * Linhas da lista aberta: por estado (quem espera primeiro), o título com a contagem e os nomes lado a lado, até
 * `maxLinhas` linhas; o que não cabe vira "e mais N" no fim da última.
 */
export function linhasDaLista(r: RodaDaSala, largura: number, medir: (texto: string) => number, maxLinhas = MAX_LINHAS): LinhaDaLista[] {
  const out: LinhaDaLista[] = [];
  for (const estado of ESTADOS) {
    const n = r[estado];
    if (!n) continue;
    out.push({ tipo: 'secao', estado, texto: tituloDaSecao(estado, n) });
    const membros = r.membros.filter((m) => estadoNaRoda(m.status) === estado);
    const linhas: ItemDaLista[][] = [];
    let linha: ItemDaLista[] = [];
    let x = 0;
    for (const m of membros) {
      const w = Math.min(largura, medir(m.name));
      if (linha.length && x + w > largura) {
        linhas.push(linha);
        linha = [];
        x = 0;
      }
      linha.push({ id: m.id, texto: m.name, x, w });
      x += w + GAP_NOME;
    }
    if (linha.length) linhas.push(linha);
    if (linhas.length > maxLinhas) {
      linhas.length = maxLinhas;
      const ultima = linhas[maxLinhas - 1];
      let mostrados = linhas.reduce((s, l) => s + l.length, 0);
      const mais = () => `e mais ${membros.length - mostrados}`;
      const fim = () => (ultima.length ? ultima[ultima.length - 1].x + ultima[ultima.length - 1].w + GAP_NOME : 0);
      while (ultima.length && fim() + medir(mais()) > largura) {
        ultima.pop();
        mostrados--;
      }
      ultima.push({ texto: mais(), x: fim(), w: medir(mais()) });
    }
    for (const itens of linhas) out.push({ tipo: 'nomes', itens });
  }
  return out;
}

/** Altura da lista com estas linhas. */
export function alturaDaLista(linhas: readonly LinhaDaLista[]): number {
  let h = PAD + TITULO_H;
  for (const l of linhas) h += l.tipo === 'secao' ? SECAO_H : LINHA_H;
  return h + PAD - 2;
}

type Medir = (font: string, text: string) => number;
type Cortar = (font: string, text: string, maxW: number) => string;

function corDoEstado(e: EstadoNaRoda): string {
  const s = tema().paleta.status;
  return e === 'esperando' ? s.esperando : e === 'trabalhando' ? s.trabalhando : e === 'aToa' ? s.ocioso : s.concluido;
}

/** Largura da placa com estas peças. */
export function larguraDaPlaca(pecas: readonly PecaDaPlaca[], medir: Medir): number {
  let w = 9;
  for (const p of pecas) w += medir(PLACA_FONT, p.texto) + (p.alerta ? 16 : p.estado ? 17 : 8);
  return Math.ceil(w);
}

/** `caudaEmCima`: a placa está embaixo da roda e a ponta sobe até ela. */
export function desenharPlaca(ctx: CanvasRenderingContext2D, pecas: readonly PecaDaPlaca[], c: Caixa, cauda: number, caudaEmCima: boolean, destaque: string, medir: Medir): void {
  const { x, y, w, h } = c;
  const cv = tema().paleta.canvas;
  ctx.save();
  ctx.fillStyle = cv.rotuloSombra;
  ctx.beginPath();
  ctx.roundRect(x, y + 2, w, h, 7);
  ctx.fill();
  ctx.fillStyle = cv.rotuloFundo;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 7);
  const base = caudaEmCima ? y : y + h;
  const ponta = caudaEmCima ? y - 4 : y + h + 4;
  ctx.moveTo(cauda - 4, base);
  ctx.lineTo(cauda, ponta);
  ctx.lineTo(cauda + 4, base);
  ctx.fill();
  ctx.fillStyle = destaque;
  ctx.beginPath();
  ctx.roundRect(x, y, 4, h, [7, 0, 0, 7]);
  ctx.fill();
  ctx.font = PLACA_FONT;
  ctx.textBaseline = 'middle';
  let px = x + 9;
  const cy = y + h / 2 + 0.5;
  for (const p of pecas) {
    const tw = medir(PLACA_FONT, p.texto);
    if (p.alerta) {
      const balao = coresDerivadas().balao.alert;
      ctx.fillStyle = balao.fundo;
      ctx.beginPath();
      ctx.roundRect(px - 2, y + 3, tw + 8, h - 6, 5);
      ctx.fill();
      ctx.fillStyle = balao.texto;
      ctx.fillText(p.texto, px + 2, cy);
      px += tw + 8 + 8;
      continue;
    }
    if (p.estado) {
      ctx.fillStyle = corDoEstado(p.estado);
      ctx.beginPath();
      ctx.arc(px + 3, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      px += 9;
    }
    ctx.fillStyle = cv.rotuloTexto;
    ctx.fillText(p.texto, px, cy);
    px += tw + 8;
  }
  ctx.restore();
}

export interface AlvoDaLista extends Caixa {
  /** Subagente do nome. */
  id?: string;
  /** O "e mais N": leva à lista completa. */
  mais?: true;
}

/**
 * Desenha a lista aberta em `c` (largura e altura de `alturaDaLista`) e devolve onde fica cada nome e o "e mais N",
 * para o clique.
 * `cauda`: x da ponta que aponta para a roda; `abaixo` = a lista ficou embaixo da roda (a ponta sobe).
 */
export function desenharLista(
  ctx: CanvasRenderingContext2D,
  titulo: string,
  linhas: readonly LinhaDaLista[],
  c: Caixa,
  cauda: number,
  abaixo: boolean,
  selecionado: string | null,
  medir: Medir,
  cortar: Cortar,
): AlvoDaLista[] {
  const { x, y, w, h } = c;
  const cv = tema().paleta.canvas;
  const alvos: AlvoDaLista[] = [];
  ctx.save();
  ctx.textBaseline = 'middle';
  ctx.fillStyle = coresDerivadas().sombraDoBalao;
  ctx.beginPath();
  ctx.roundRect(x, y + 3, w, h, 8);
  ctx.fill();
  ctx.fillStyle = cv.rotuloFundo;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 8);
  if (abaixo) {
    ctx.moveTo(cauda - 5, y);
    ctx.lineTo(cauda, y - 6);
    ctx.lineTo(cauda + 5, y);
  } else {
    ctx.moveTo(cauda - 5, y + h);
    ctx.lineTo(cauda, y + h + 6);
    ctx.lineTo(cauda + 5, y + h);
  }
  ctx.fill();
  ctx.font = TITULO_FONT;
  ctx.fillStyle = cv.rotuloTexto;
  ctx.fillText(cortar(TITULO_FONT, titulo, w - 2 * PAD - 14), x + PAD, y + PAD + TITULO_H / 2 - 3);
  ctx.globalAlpha = 0.7;
  ctx.fillText('×', x + w - PAD - 7, y + PAD + TITULO_H / 2 - 3);
  ctx.globalAlpha = 1;
  let ly = y + PAD + TITULO_H;
  const et = coresDerivadas().etiqueta;
  for (const l of linhas) {
    if (l.tipo === 'secao') {
      ctx.font = SECAO_FONT;
      if (l.estado !== 'esperando') {
        ctx.fillStyle = corDoEstado(l.estado);
        ctx.beginPath();
        ctx.arc(x + PAD + 3, ly + SECAO_H / 2, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = l.estado === 'esperando' ? tema().paleta.status.esperando : cv.compactoTexto;
      ctx.fillText(l.texto, x + PAD + (l.estado === 'esperando' ? 0 : 10), ly + SECAO_H / 2);
      ly += SECAO_H;
      continue;
    }
    ctx.font = NOME_FONT;
    for (const it of l.itens) {
      const ix = x + PAD + it.x;
      if (it.id && it.id === selecionado) {
        ctx.fillStyle = et.selecionada;
        ctx.beginPath();
        ctx.roundRect(ix - 3, ly + 1, it.w + 6, LINHA_H - 2, 6);
        ctx.fill();
      }
      ctx.globalAlpha = it.id ? 1 : 0.65;
      ctx.fillStyle = cv.rotuloTexto;
      ctx.fillText(cortar(NOME_FONT, it.texto, w - 2 * PAD), ix, ly + LINHA_H / 2);
      ctx.globalAlpha = 1;
      alvos.push(it.id ? { id: it.id, x: ix - 3, y: ly, w: it.w + 6, h: LINHA_H } : { mais: true, x: ix - 3, y: ly, w: it.w + 6, h: LINHA_H });
    }
    ly += LINHA_H;
  }
  ctx.restore();
  return alvos;
}
