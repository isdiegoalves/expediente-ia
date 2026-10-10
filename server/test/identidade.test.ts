import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const REPOSITORIO = 'isdiegoalves/expediente-ia';
const ORIGINAL = /marmottajr\/habblaud/i;

/** Arquivo -> o que justifica citar o repositório do projeto de origem; `linha` limita a quais linhas vale. */
const PODE_CITAR_ORIGEM: Record<string, { motivo: string; linha?: RegExp }> = {
  NOTICE: { motivo: 'aviso de licença do projeto de origem' },
  'README.md': { motivo: 'linha "Origem" com crédito e licença', linha: /^> \*\*Origem\.\*\*/ },
  'CHANGELOG.md': { motivo: 'parágrafo do histórico anterior à 1.0.0', linha: /cb0c0bb/ },
  'scripts/renomear-fork.mjs': { motivo: 'o script que troca o nome do projeto de origem' },
  'server/test/nomes.test.ts': { motivo: 'o teste que separa o nome de origem do resto' },
  'server/test/identidade.test.ts': { motivo: 'este teste' },
};

function versionados(): string[] {
  const r = spawnSync('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.split('\0').filter((f) => f && !/\.(png|jpe?g|gif|webp|ico|woff2?|ttf|zip)$/i.test(f));
}

describe('identidade do Expediente', () => {
  it('o repositório do projeto de origem só aparece onde está justificado', () => {
    const fora: string[] = [];
    for (const arquivo of versionados()) {
      const permitido = PODE_CITAR_ORIGEM[arquivo];
      readFileSync(resolve(ROOT, arquivo), 'utf8')
        .split('\n')
        .forEach((linha, i) => {
          if (ORIGINAL.test(linha) && !(permitido && (!permitido.linha || permitido.linha.test(linha)))) fora.push(`${arquivo}:${i + 1}`);
        });
    }
    expect(fora).toEqual([]);
  });

  it('o README manda clonar o repositório do Expediente', () => {
    const readme = readFileSync(resolve(ROOT, 'README.md'), 'utf8');
    const clones = [...readme.matchAll(/git clone\s+(\S+)/g)].map((m) => m[1]);
    expect(clones.length).toBeGreaterThan(0);
    for (const url of clones) expect(url).toBe(`https://github.com/${REPOSITORIO}.git`);
    expect(readme).toContain(`cd ${REPOSITORIO.split('/')[1]}\n`);
  });

  it('os links de release do CHANGELOG são do Expediente', () => {
    const links = [...readFileSync(resolve(ROOT, 'CHANGELOG.md'), 'utf8').matchAll(/^\[[^\]]+\]:\s*(\S+)/gm)].map((m) => m[1]);
    expect(links.length).toBeGreaterThan(0);
    for (const url of links) expect(url).toContain(`github.com/${REPOSITORIO}/`);
  });
});
