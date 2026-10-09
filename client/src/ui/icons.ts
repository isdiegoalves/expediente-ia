// Ícones da interface em pixel art (mapas de pixels -> SVG com bordas nítidas), coerentes com o escritório.
// Cada '#' é um pixel pintado com currentColor; renderizados a 2 px de tela por pixel.
import { tema } from '../tema';

const { marca } = tema().paleta;

function pixelPaths(rows: readonly string[], palette: Readonly<Record<string, string>>): string {
  let out = '';
  for (const [ch, color] of Object.entries(palette)) {
    let d = '';
    rows.forEach((row, y) => {
      // Agrupa pixels consecutivos da linha num único retângulo.
      let x = 0;
      while (x < row.length) {
        if (row[x] !== ch) {
          x++;
          continue;
        }
        let run = 1;
        while (row[x + run] === ch) run++;
        d += `M${x} ${y}h${run}v1h-${run}z`;
        x += run;
      }
    });
    if (d) out += `<path fill="${color}" d="${d}"/>`;
  }
  return out;
}

export function pixelIcon(rows: readonly string[], palette: Readonly<Record<string, string>> = { '#': 'currentColor' }, cls = 'ui-px-icon'): string {
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  return `<svg class="${cls}" width="${w * 2}" height="${h * 2}" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges" aria-hidden="true" focusable="false">${pixelPaths(rows, palette)}</svg>`;
}

export const ICONS = {
  overview: pixelIcon([
    '###....###',
    '#........#',
    '#........#',
    '...####...',
    '...#..#...',
    '...#..#...',
    '...####...',
    '#........#',
    '#........#',
    '###....###',
  ]),
  zoomIn: pixelIcon([
    '..........',
    '....##....',
    '....##....',
    '....##....',
    '.########.',
    '.########.',
    '....##....',
    '....##....',
    '....##....',
    '..........',
  ]),
  zoomOut: pixelIcon([
    '..........',
    '..........',
    '..........',
    '..........',
    '.########.',
    '.########.',
    '..........',
    '..........',
    '..........',
    '..........',
  ]),
  sidebar: pixelIcon([
    '##########',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '#..#.....#',
    '##########',
  ]),
  feed: pixelIcon([
    '##########',
    '#........#',
    '#........#',
    '#........#',
    '##########',
    '#.##.###.#',
    '#........#',
    '#.##.##..#',
    '#........#',
    '##########',
  ]),
  settings: pixelIcon([
    '....##....',
    '.#.####.#.',
    '..######..',
    '.###..###.',
    '####..####',
    '####..####',
    '.###..###.',
    '..######..',
    '.#.####.#.',
    '....##....',
  ]),
  help: pixelIcon([
    '..######..',
    '.##....##.',
    '.##....##.',
    '......##..',
    '.....##...',
    '....##....',
    '....##....',
    '..........',
    '....##....',
    '....##....',
  ]),
  pencil: pixelIcon([
    '.......##.',
    '......#..#',
    '.....#..#.',
    '....#..#..',
    '...#..#...',
    '..#..#....',
    '.#..#.....',
    '.#.#......',
    '.##.......',
    '..........',
  ]),
  maximize: pixelIcon([
    '..........',
    '.####.....',
    '.##.......',
    '.#.#......',
    '.#........',
    '........#.',
    '......#.#.',
    '.......##.',
    '.....####.',
    '..........',
  ]),
  restore: pixelIcon([
    '..........',
    '...#......',
    '...#......',
    '.###......',
    '..........',
    '..........',
    '......###.',
    '......#...',
    '......#...',
    '..........',
  ]),
  close: pixelIcon([
    '..........',
    '.##....##.',
    '.###..###.',
    '..######..',
    '...####...',
    '...####...',
    '..######..',
    '.###..###.',
    '.##....##.',
    '..........',
  ]),
  search: pixelIcon([
    '.####.....',
    '#....#....',
    '#....#....',
    '#....#....',
    '#....#....',
    '.####.....',
    '.....##...',
    '......##..',
    '.......##.',
    '........#.',
  ]),
  copy: pixelIcon([
    '...#######',
    '...#.....#',
    '...#.....#',
    '#######..#',
    '#.....#..#',
    '#.....#..#',
    '#.....####',
    '#.....#...',
    '#.....#...',
    '#######...',
  ]),
  check: pixelIcon([
    '..........',
    '.........#',
    '........##',
    '.......##.',
    '#.....##..',
    '##...##...',
    '.##.##....',
    '..###.....',
    '...#......',
    '..........',
  ]),
  follow: pixelIcon([
    '....##....',
    '....##....',
    '..######..',
    '.#......#.',
    '##..##..##',
    '##..##..##',
    '.#......#.',
    '..######..',
    '....##....',
    '....##....',
  ]),
  center: pixelIcon([
    '###....###',
    '#........#',
    '#........#',
    '....##....',
    '...####...',
    '...####...',
    '....##....',
    '#........#',
    '#........#',
    '###....###',
  ]),
  hand: pixelIcon([
    '...#.#....',
    '..#.#.#...',
    '..#.#.#.#.',
    '..#.#.#.#.',
    '..#######.',
    '#.#######.',
    '##.######.',
    '.########.',
    '..######..',
    '...####...',
  ]),
  warn: pixelIcon([
    '....##....',
    '...####...',
    '...#..#...',
    '..##..##..',
    '..##..##..',
    '.###..###.',
    '.########.',
    '####..####',
    '##########',
    '..........',
  ]),
  clock: pixelIcon([
    '..######..',
    '.#......#.',
    '#....#...#',
    '#....#...#',
    '#....###.#',
    '#........#',
    '#........#',
    '.#......#.',
    '..######..',
    '..........',
  ]),
  // Ampulheta (esperando o shell): moldura na cor do texto e areia âmbar caindo.
  hourglass: pixelIcon(
    [
      '#########',
      '.#sssss#.',
      '.#sssss#.',
      '..#sss#..',
      '...#s#...',
      '...#s#...',
      '..#.s.#..',
      '.#..s..#.',
      '.#.sss.#.',
      '#########',
    ],
    { '#': 'currentColor', s: marca.estrela },
  ),
  // Janela de terminal com o prompt ">_" (terminal somente leitura).
  terminal: pixelIcon([
    '##########',
    '#........#',
    '#.#......#',
    '#..#.....#',
    '#...#....#',
    '#..#.....#',
    '#.#..###.#',
    '#........#',
    '##########',
  ]),
  lock: pixelIcon(['..####..', '.##..##.', '.#....#.', '.#....#.', '########', '###..###', '###..###', '########', '########']),
  chevronDown: pixelIcon(['#......#', '##....##', '.##..##.', '..####..', '...##...']),
  chevronUp: pixelIcon(['...##...', '..####..', '.##..##.', '##....##', '#......#']),
  arrowDown: pixelIcon(['...##...', '...##...', '...##...', '#######.', '.#####..', '..###...', '...#....'].map((r) => r.padEnd(8, '.'))),
} as const;

export type IconKey = keyof typeof ICONS;

/** Marca do Expediente em pixels (usada quando /assets/brand/logo-mark.png não existe): prédio com janelas acesas. */
export const FALLBACK_MARK = pixelIcon(
  [
    '.....######.....',
    '.....#rrrr#.....',
    '..############..',
    '..#llllllllll#..',
    '..#lwwlwwlbbl#..',
    '..#lwwlwwlbbl#..',
    '..#llllllllll#..',
    '..#lbblwwlwwl#..',
    '..#lbblwwlwwl#..',
    '..#llllllllll#..',
    '..#lwwlddlbbl#..',
    '..#lwwlddlbbl#..',
    '..#llllddllll#..',
    '################',
  ],
  { '#': marca.simbolo[0], l: marca.simbolo[1], r: marca.simbolo[2], w: marca.simbolo[3], b: marca.simbolo[4], d: marca.simbolo[5] },
  'ui-px-icon ui-mark',
);

/**
 * Logotipo "Expediente" em pixels, com a mesma fonte bitmap da placa da marca (temas/padrao/brand/signage.png): a
 * Pixelify Sans não fica nítida nesse tamanho. As linhas vêm de `node scripts/gerar-marca.mjs --linhas`.
 * c = texto, t = destaque, s = sombra de 1 px.
 */
export const WORDMARK_ROWS = [
  'ccccc.c...c.cccc..ccccc.cccc..ttt.ttttt.t...t.ttttt.ttttt',
  'cssss.c...c.csssc.cssss.csssc.sts.tssss.tt..t.sstss.tssss',
  'c.....sc.cs.c...c.c.....c...c..t..t.....tst.t...t...t....',
  'cccc...scs..ccccs.cccc..c...c..t..tttt..t.t.t...t...tttt.',
  'csss...csc..csss..csss..c...c..t..tsss..t.stt...t...tsss.',
  'c.....cs.sc.c.....c.....c...c..t..t.....t..st...t...t....',
  'ccccc.c...c.c.....ccccc.ccccs.ttt.ttttt.t...t...t...ttttt',
  'sssss.s...s.s.....sssss.ssss..sss.sssss.s...s...s...sssss',
] as const;

export const WORDMARK = pixelIcon(WORDMARK_ROWS, { s: marca.letreiro[0], c: marca.letreiro[1], t: marca.letreiro[2] }, 'ui-wordmark');
