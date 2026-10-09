import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const SCRIPTS = new Set(Object.keys(JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>));

// Scripts de projetos imaginários, usados como comando de exemplo em dados de teste e na simulação da demo.
const DE_OUTRO_PROJETO = new Set(['lint', 'db:migrate', 'db:seed', 'e2e']);

function arquivos(): string[] {
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '--', 'client', 'server', 'mod', 'shared', 'scripts', '*README.md'], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.split('\n').filter((f) => /\.(ts|tsx|mjs|js|md)$/.test(f));
}

describe('scripts citados', () => {
  it('todo "npm run <nome>" escrito no código e nos README existe no package.json', () => {
    const faltando: string[] = [];
    for (const arquivo of arquivos()) {
      for (const m of readFileSync(resolve(ROOT, arquivo), 'utf8').matchAll(/npm run ([\w:.-]+)/g)) {
        if (!SCRIPTS.has(m[1]) && !DE_OUTRO_PROJETO.has(m[1])) faltando.push(`${arquivo}: npm run ${m[1]}`);
      }
    }
    expect(faltando).toEqual([]);
  });
});
