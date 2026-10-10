// Decorações procedurais em pixel art. Mesma escala dos móveis do escritório.
import { PixelBuf } from './core/pixbuf';
import type { BufSprite } from './core/sprite';
import { sazonal } from '../tema';

export type SeasonalProp = 'tree' | 'gift' | 'pumpkin' | 'ghost' | 'wreath' | 'bat';

export function renderSeasonalProp(kind: SeasonalProp): BufSprite {
  const b = new PixelBuf(40, 64);
  const { natal: n, halloween: h } = sazonal();
  const rect = (x: number, y: number, w: number, h: number, c: string) => b.rect(x, y, w, h, c);
  if (kind === 'tree') {
    b.shadow(20, 59, 17, 3, n.sombra, 0.22);
    rect(17, 49, 6, 9, n.tronco);
    for (let row = 0; row < 4; row++) {
      const y = 13 + row * 8;
      const half = 6 + row * 3;
      rect(20 - half, y, half * 2 + 1, 9, n.arvoreEscuro);
      rect(22 - half, y, half * 2 - 4, 6, n.arvoreMedio);
      rect(22 - half, y + 1, half - 1, 3, n.arvoreClaro);
    }
    b.vline(20, 5, 13, n.estrela);
    b.hline(16, 24, 9, n.estrela);
    rect(18, 7, 5, 5, n.estrelaMiolo);
    for (const [x, y] of [[16, 20], [24, 24], [13, 31], [25, 36], [9, 42], [20, 43], [31, 44]]) {
      rect(x, y, 3, 3, n.bola);
      b.set(x, y, n.bolaBrilho);
    }
    for (const [x, y] of [[21, 17], [15, 26], [23, 30], [15, 38], [26, 42], [11, 47]]) {
      rect(x, y, 2, 2, n.luzArvore);
    }
    rect(3, 52, 10, 8, n.caixaVinho);
    rect(6, 51, 2, 9, n.fitaDourada);
    rect(3, 54, 10, 1, n.fitaDourada);
    rect(26, 51, 10, 9, n.caixaDourada);
    rect(30, 50, 2, 10, n.fitaVinho);
    rect(26, 54, 10, 1, n.fitaVinho);
  } else if (kind === 'gift') {
    b.shadow(20, 59, 9, 2, n.sombra, 0.2);
    rect(11, 49, 17, 11, n.presenteVermelho);
    rect(11, 49, 17, 3, n.presenteTopo);
    rect(18, 49, 3, 11, n.presenteFita);
    rect(11, 54, 17, 2, n.presenteFita);
    rect(14, 46, 5, 3, n.presenteLaco);
    rect(21, 46, 5, 3, n.presenteLaco);
  } else if (kind === 'pumpkin') {
    b.shadow(20, 59, 11, 2, h.sombra, 0.2);
    rect(18, 41, 3, 6, h.decoCaule);
    rect(11, 46, 18, 14, h.decoCasca);
    rect(8, 49, 24, 8, h.decoCascaClara);
    rect(13, 46, 4, 13, h.decoGomo);
    rect(23, 47, 3, 12, h.decoGomo);
    rect(12, 50, 4, 3, h.decoOlho);
    rect(24, 50, 4, 3, h.decoOlho);
    rect(17, 56, 7, 2, h.decoOlho);
    b.set(13, 51, h.decoBrilho);
    b.set(25, 51, h.decoBrilho);
    b.hline(18, 22, 56, h.decoBrilho);
  } else if (kind === 'ghost') {
    rect(15, 39, 10, 3, h.fantasma);
    rect(12, 42, 16, 15, h.fantasma);
    rect(14, 41, 11, 15, h.fantasmaClaro);
    rect(10, 47, 4, 4, h.fantasma);
    rect(26, 47, 4, 4, h.fantasma);
    for (const x of [12, 18, 24]) rect(x, 56, 4, 3, h.fantasma);
    rect(16, 46, 2, 3, h.fantasmaOlho);
    rect(23, 46, 2, 3, h.fantasmaOlho);
    rect(19, 51, 3, 2, h.fantasmaOlho);
  } else if (kind === 'wreath') {
    rect(12, 39, 16, 4, n.folhagem);
    rect(10, 43, 5, 10, n.arvoreEscuro);
    rect(25, 43, 5, 10, n.folhagem);
    rect(13, 53, 15, 4, n.arvoreEscuro);
    for (const [x, y] of [[14, 41], [26, 47], [12, 50], [23, 54]]) rect(x, y, 2, 2, n.coroaFruto);
    rect(15, 55, 4, 4, n.lacoCoroa);
    rect(21, 55, 4, 4, n.lacoCoroa);
    rect(19, 54, 2, 4, n.lacoCoroaBrilho);
  } else {
    rect(18, 51, 5, 6, h.morcego);
    rect(10, 50, 9, 4, h.morcego);
    rect(22, 50, 9, 4, h.morcego);
    rect(7, 48, 4, 4, h.morcego);
    rect(30, 48, 4, 4, h.morcego);
    rect(13, 53, 3, 3, h.morcego);
    rect(25, 53, 3, 3, h.morcego);
    b.set(19, 52, h.morcegoOlho);
    b.set(21, 52, h.morcegoOlho);
  }
  b.outline();
  return { buf: b, ax: 20, ay: 60 };
}
