import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const MUNDO = resolve(__dirname, '../../client/src/world');

describe('decoração sazonal', () => {
  it.each(['sim', 'layout', 'path'])('world/%s não conhece o tema: caminhos e posições não mudam com a decoração', (pasta) => {
    const arquivos = readdirSync(join(MUNDO, pasta)).filter((a) => a.endsWith('.ts') && !a.endsWith('.test.ts'));
    expect(arquivos.length).toBeGreaterThan(0);
    for (const arq of arquivos) {
      expect(readFileSync(join(MUNDO, pasta, arq), 'utf8'), `${pasta}/${arq}`).not.toMatch(/seasonal|OfficeTheme|options\.theme/);
    }
  });
});
