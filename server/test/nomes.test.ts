import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

const PODEM_CITAR_HABBLAUD = new Set(['LICENSE', 'NOTICE', 'README.md', 'scripts/renomear-fork.mjs', 'scripts/instalar.ts', 'server/test/instalar.test.ts', 'server/test/nomes.test.ts', 'server/http/guard.test.ts']);
const PODEM_CITAR_4747 = new Set(['scripts/renomear-fork.mjs', 'server/test/nomes.test.ts']);
const REPOSITORIO_ORIGINAL = /marmottajr\/habblaud/gi;

function achados(padrao: string, ignoraCase: boolean): Array<{ arquivo: string; linha: string }> {
  const args = ['grep', '-n', '-I', '--untracked', '--exclude-standard', ...(ignoraCase ? ['-i'] : []), '-e', padrao];
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0 && r.status !== 1) throw new Error(r.stderr);
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const [arquivo, , ...resto] = l.split(':');
      return { arquivo, linha: resto.join(':') };
    });
}

describe('nomes do fork', () => {
  it('"habblaud" só aparece nos arquivos de origem e licença, fora o endereço do repositório original', () => {
    const fora = achados('habblaud', true)
      .filter((a) => !PODEM_CITAR_HABBLAUD.has(a.arquivo))
      .filter((a) => /habblaud/i.test(a.linha.replace(REPOSITORIO_ORIGINAL, '')))
      .map((a) => a.arquivo);
    expect([...new Set(fora)]).toEqual([]);
  });

  it('a porta 4747 do Habblaud não aparece em lugar nenhum', () => {
    const fora = achados('4747', false).filter((a) => !PODEM_CITAR_4747.has(a.arquivo)).map((a) => a.arquivo);
    expect([...new Set(fora)]).toEqual([]);
  });
});
