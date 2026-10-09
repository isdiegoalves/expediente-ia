import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const ORIGEM = 'cb0c0bb';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

function daOrigem(caminho: string): Buffer | undefined {
  try {
    return execFileSync('git', ['-C', ROOT, 'show', `${ORIGEM}:${caminho}`], { maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

const temOrigem = daOrigem('client/public/assets/manifest.json') !== undefined;

/** Imagem de marca ou prévia do Expediente → caminho que ela tinha na origem. */
function pngsDeMarca(): [string, string][] {
  const doBrand = (dir: string) => readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.png')).map((n): [string, string] => [`${dir}/${n}`, `client/public/assets/brand/${n}`]);
  return [...doBrand('client/public/assets/brand'), ...doBrand('client/public/temas/padrao/brand'), ['client/public/assets/og-image.png', 'client/public/assets/og-image.png']];
}

describe.skipIf(!temOrigem)('marca própria', () => {
  it('há PNG de marca para conferir', () => {
    expect(pngsDeMarca().length).toBeGreaterThanOrEqual(10);
  });

  it.each(pngsDeMarca())('%s não é o arquivo da origem', (atual, antigo) => {
    const velho = daOrigem(antigo);
    if (!velho) return;
    expect(sha(readFileSync(join(ROOT, atual)))).not.toBe(sha(velho));
  });
});
