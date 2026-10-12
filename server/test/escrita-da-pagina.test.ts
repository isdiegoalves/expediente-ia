import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('toda escrita da página passa por tokenLocal.escrever', () => {
  const RAIZ = join(__dirname, '../../client/src');
  const fontes: string[] = [];
  const varrer = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory()) varrer(join(dir, e.name));
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) fontes.push(join(dir, e.name));
    }
  };
  varrer(RAIZ);

  /** O texto de cada chamada `fetch(...)` (até o parêntese que a fecha). */
  function chamadasDeFetch(fonte: string): string[] {
    const achadas: string[] = [];
    for (const m of fonte.matchAll(/(?<![.\w])fetch\(/g)) {
      let fundo = 1;
      let i = m.index! + m[0].length;
      for (; i < fonte.length && fundo > 0; i++) fundo += fonte[i] === '(' ? 1 : fonte[i] === ')' ? -1 : 0;
      achadas.push(fonte.slice(m.index, i));
    }
    return achadas;
  }

  it('nenhum fetch direto vai a um GET que muda estado no servidor (wait, focos, /ir), que exige a prova', () => {
    for (const arquivo of fontes) {
      for (const chamada of chamadasDeFetch(readFileSync(arquivo, 'utf8'))) {
        expect(chamada, arquivo).not.toMatch(/\/wait|mod\/focos|\/ir[`'"?]/);
      }
    }
  });

  it('nenhum fetch direto leva método de escrita', () => {
    expect(fontes.length).toBeGreaterThan(20);
    for (const arquivo of fontes) {
      for (const chamada of chamadasDeFetch(readFileSync(arquivo, 'utf8'))) {
        expect(chamada, arquivo).not.toMatch(/method|['"](?:POST|PUT|PATCH|DELETE)['"]/);
      }
    }
  });

  it('os quatro arquivos de escrita usam tokenLocal.escrever', () => {
    const usos = fontes.filter((f) => /tokenLocal\.escrever\(/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(RAIZ.length + 1));
    expect(usos.sort()).toEqual(['net/presenca.ts', 'net/store.ts', 'ui/ir.ts', 'ui/roomrename.ts']);
  });

  it('no ir.ts, só o GET passa direto: POST e DELETE do foco vão com o token', () => {
    expect(readFileSync(join(RAIZ, 'ui/ir.ts'), 'utf8')).toContain('init?.method ? tokenLocal.escrever(url, init) : fetch(url, init)');
  });

  it('o segredo não é guardado como texto: token.ts não usa localStorage, sessionStorage nem cookie, e só o IndexedDB guarda a chave', () => {
    const token = readFileSync(join(RAIZ, 'net/token.ts'), 'utf8');
    expect(token).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    expect(token).toMatch(/importKey\('raw', bytes, HMAC, false, \['sign'\]\)/);
    const usos = fontes.filter((f) => /\.importKey\(/.test(readFileSync(f, 'utf8'))).map((f) => f.slice(RAIZ.length + 1));
    expect(usos).toEqual(['net/token.ts']);
  });

  it('o store escreve pelo token nas quatro chamadas (demo, ritmo, decisão e personagem, PUT e DELETE)', () => {
    const store = readFileSync(join(RAIZ, 'net/store.ts'), 'utf8');
    expect(store.match(/tokenLocal\.escrever\(/g)).toHaveLength(4);
  });
});
