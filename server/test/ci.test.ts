import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const WORKFLOW = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8');
const SCRIPTS = new Set(Object.keys(JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')).scripts as Record<string, string>));

const SEM_SHA = new Set<string>();

describe('workflow de CI', () => {
  it('toda ação é fixada por SHA de 40 hexadecimais ou está listada como pendente', () => {
    const usos = [...WORKFLOW.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
    expect(usos.length).toBeGreaterThan(0);
    const soltas = usos.filter((u) => !/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/.test(u));
    expect(soltas.filter((u) => !SEM_SHA.has(u))).toEqual([]);
  });

  it('a lista de pendentes só tem ações que o workflow ainda usa sem SHA', () => {
    for (const pendente of SEM_SHA) expect(WORKFLOW).toContain(`uses: ${pendente}`);
  });

  it('declara permissions somente de leitura no topo', () => {
    expect(WORKFLOW).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(WORKFLOW).not.toMatch(/write/);
  });

  it('não usa segredos', () => {
    expect(WORKFLOW).not.toMatch(/secrets\./);
  });

  it('os "npm run" existem no package.json e o npm test está presente', () => {
    const rodados = [...WORKFLOW.matchAll(/run:\s*npm run ([\w:.-]+)/g)].map((m) => m[1]);
    expect(rodados.length).toBeGreaterThan(0);
    expect(rodados.filter((s) => !SCRIPTS.has(s))).toEqual([]);
    expect(WORKFLOW).toMatch(/run:\s*npm test\b/);
    expect(SCRIPTS.has('test')).toBe(true);
  });

  it('os arquivos que o workflow roda existem', () => {
    const alvos = [...WORKFLOW.matchAll(/run:\s*node --test (\S+)/g)].map((m) => m[1]);
    expect(alvos.length).toBeGreaterThan(0);
    for (const alvo of alvos) expect(() => readFileSync(resolve(ROOT, alvo), 'utf8')).not.toThrow();
  });
});
