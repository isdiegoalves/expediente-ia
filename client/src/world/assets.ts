// Decoração em PNG do tema ativo (quadros, pôsteres, a placa da recepção e o logo): `decoracao` do tema.
// Arquivo que não carrega fica de fora e o mundo segue com a arte procedural.
import { tema, urlDoTema } from '../tema';

export interface WallArtAsset {
  id: string;
  kind: 'painting' | 'poster';
  img: HTMLImageElement;
  w: number;
  h: number;
  /** Largura em tiles do lugar na parede (quadros: 2 ou 4; pôsteres: 1). */
  tiles: number;
  /** Pôster: variante procedural equivalente ('code', 'coffee'...). */
  variant?: string;
  /** Versão com moldura pronta (desenhada no lugar do quadro procedural, em tamanho nativo). */
  framed?: BrandAsset;
}

export interface BrandAsset {
  img: HTMLImageElement;
  w: number;
  h: number;
}

export interface WorldAssets {
  wallArt: WallArtAsset[];
  signage?: BrandAsset;
  mark?: BrandAsset;
}

function loadImage(arquivo: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img.naturalWidth > 0 ? img : null);
    img.onerror = () => resolve(null);
    img.src = urlDoTema(arquivo);
  });
}

const brand = async (arquivo: string): Promise<BrandAsset | undefined> => {
  const img = await loadImage(arquivo);
  return img ? { img, w: img.naturalWidth, h: img.naturalHeight } : undefined;
};

export async function loadWorldAssets(): Promise<WorldAssets | null> {
  const { quadros, marca } = tema().decoracao;
  const imgs = await Promise.all(quadros.map((q) => loadImage(q.arquivo)));
  const framed = await Promise.all(quadros.map((q) => (q.moldura ? loadImage(q.moldura.arquivo) : Promise.resolve(null))));
  const wallArt: WallArtAsset[] = [];
  quadros.forEach((q, i) => {
    const img = imgs[i];
    if (!img) return;
    const f = framed[i];
    wallArt.push({
      id: q.id,
      kind: q.tipo,
      img,
      w: img.naturalWidth,
      h: img.naturalHeight,
      tiles: q.tiles ?? (q.tipo === 'poster' ? 1 : img.naturalWidth > 40 ? 4 : 2),
      variant: q.variante,
      framed: f ? { img: f, w: f.naturalWidth, h: f.naturalHeight } : undefined,
    });
  });
  const [signage, mark] = await Promise.all([brand(marca.placa.arquivo), brand(marca.logo.arquivo)]);
  if (!wallArt.length && !signage && !mark) return null;
  return { wallArt, signage, mark };
}
