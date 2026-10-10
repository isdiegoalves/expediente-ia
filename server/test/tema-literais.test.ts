import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const ARQUIVOS = [
  'client/src/ui/styles.css',
  'client/src/art/theme.ts',
  'client/src/world/render/overlay.ts',
  'client/src/world/layout/core.ts',
  'client/src/art/surfaces/floor.ts',
  'client/src/world/render/renderer.ts',
  'client/src/world/render/roda.ts',
  'client/src/world/render/roda-texto.ts',
  'client/src/ui/icons.ts',
  'client/src/art/seasonal.ts',
  'client/src/world/render/seasonal.ts',
];
const LITERAL_DE_COR = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/g;

describe('cor vem do tema', () => {
  it.each(ARQUIVOS)('%s não tem literal de cor', (arquivo) => {
    const achados = readFileSync(resolve(ROOT, arquivo), 'utf8').match(LITERAL_DE_COR) ?? [];
    expect(achados).toEqual([]);
  });
});
