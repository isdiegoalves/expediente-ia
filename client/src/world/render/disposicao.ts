// Onde cada texto flutuante do escritório fica na tela sem cobrir outro. Puro: o overlay mede e desenha; aqui só se
// decide o lugar, em px CSS.

export interface Caixa {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function sobrepoe(a: Caixa, b: Caixa): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** O que já foi posto na tela neste quadro (placas, pílulas, balões, etiquetas). */
export class Ocupacao {
  private r: number[] = [];

  limpar(): void {
    this.r.length = 0;
  }

  livre(x: number, y: number, w: number, h: number): boolean {
    const p = this.r;
    for (let i = 0; i < p.length; i += 4) {
      if (x < p[i] + p[i + 2] && x + w > p[i] && y < p[i + 1] + p[i + 3] && y + h > p[i + 1]) return false;
    }
    return true;
  }

  ocupar(x: number, y: number, w: number, h: number): void {
    this.r.push(x, y, w, h);
  }
}

export interface PedidoDeBalao {
  /** x sobre o qual o balão se centra (a cabeça). */
  cx: number;
  /** y da base do balão na posição normal (o balão fica acima). */
  base: number;
  w: number;
  h: number;
  /** Tamanho só com o ícone, quando o texto não cabe; ausente = não encolhe. */
  chip?: { w: number; h: number };
  /** Quantas alturas pode subir (e, subindo, andar para o lado) antes de encolher; 0 = só o lugar normal. */
  degraus: number;
}

export interface LugarDoBalao extends Caixa {
  chip: boolean;
  /** Quantas alturas subiu (o rabicho desce até a cabeça). */
  degraus: number;
}

const MARGEM = 4;
const ESPACO = 6;

/**
 * Primeiro lugar livre para o balão: o normal; subindo degrau a degrau, no meio, à esquerda e à direita; depois o
 * mesmo só com o ícone. null = não cabe sem cobrir nada, e o balão não aparece.
 */
export function lugarDoBalao(p: PedidoDeBalao, telaW: number, livre: (x: number, y: number, w: number, h: number) => boolean): LugarDoBalao | null {
  const tentar = (w: number, h: number, chip: boolean): LugarDoBalao | null => {
    const prende = (x: number) => Math.max(MARGEM, Math.min(telaW - w - MARGEM, Math.round(x)));
    const x0 = prende(p.cx - w / 2);
    const y0 = Math.round(p.base - h);
    if (livre(x0, y0, w, h)) return { x: x0, y: y0, w, h, chip, degraus: 0 };
    for (let d = p.degraus ? 0 : 1; d <= p.degraus; d++) {
      const y = y0 - d * (h + ESPACO);
      for (const dx of d ? [0, -(w / 2 + ESPACO), w / 2 + ESPACO] : [-(w / 2 + ESPACO), w / 2 + ESPACO]) {
        const x = prende(x0 + dx);
        if (livre(x, y, w, h)) return { x, y, w, h, chip, degraus: d };
      }
    }
    return null;
  };
  return tentar(p.w, p.h, false) ?? (p.chip ? tentar(p.chip.w, p.chip.h, true) : null);
}
