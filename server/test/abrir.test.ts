import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const SCRIPT = resolve(__dirname, '../../scripts/abrir.mjs');
const TOKEN = '5e17e11a'.repeat(8);

interface Resultado {
  codigo: number;
  linhas: string[];
}
const { abrir, comandoDeAbrir, lerToken, portaDe, urlDoEscritorio } = (await import(pathToFileURL(SCRIPT).href)) as {
  abrir(o: { env?: NodeJS.ProcessEnv; home: string; plataforma?: string; executar(c: string, a: string[]): number }): Resultado;
  comandoDeAbrir(p: string): string;
  lerToken(home: string): string | undefined;
  portaDe(env: NodeJS.ProcessEnv): number;
  urlDoEscritorio(token: string, porta: number): string;
};

function homeCom(token: string | undefined): { home: string; limpar(): void } {
  const home = mkdtempSync(join(tmpdir(), 'expediente-abrir-'));
  mkdirSync(join(home, '.expediente', 'host'), { recursive: true });
  if (token !== undefined) writeFileSync(join(home, '.expediente', 'host', 'token'), token, { mode: 0o600 });
  return { home, limpar: () => rmSync(home, { recursive: true, force: true }) };
}

describe('abrir: funções', () => {
  it('lê o token só se tiver 64 hexadecimais minúsculos', () => {
    for (const [conteudo, esperado] of [[`${TOKEN}\n`, TOKEN], [TOKEN, TOKEN], ['abc', undefined], ['', undefined], [TOKEN.toUpperCase(), undefined], [`${TOKEN}0`, undefined], [undefined, undefined]] as const) {
      const h = homeCom(conteudo);
      try {
        expect(lerToken(h.home), String(conteudo)).toBe(esperado);
      } finally {
        h.limpar();
      }
    }
  });

  it('a URL leva o token no fragmento; a porta vem de EXPEDIENTE_PORT ou é 4848', () => {
    expect(urlDoEscritorio(TOKEN, 4848)).toBe(`http://localhost:4848/#t=${TOKEN}`);
    expect([portaDe({}), portaDe({ EXPEDIENTE_PORT: '5000' }), portaDe({ EXPEDIENTE_PORT: 'x' }), portaDe({ EXPEDIENTE_PORT: '70000' }), portaDe({ EXPEDIENTE_PORT: '0' })]).toEqual([4848, 5000, 4848, 4848, 4848]);
  });

  it('open no macOS, xdg-open no resto', () => {
    expect([comandoDeAbrir('darwin'), comandoDeAbrir('linux')]).toEqual(['open', 'xdg-open']);
  });

  it('sem token válido não abre nada e diz o que fazer, sem inventar valor', () => {
    const h = homeCom(undefined);
    try {
      const chamadas: string[][] = [];
      const r = abrir({ home: h.home, env: {}, executar: (c, a) => (chamadas.push([c, ...a]), 0) });
      expect(r.codigo).toBe(1);
      expect(chamadas).toEqual([]);
      expect(r.linhas.join('\n')).toContain('npm run docker:up');
    } finally {
      h.limpar();
    }
  });

  it('com token abre a URL com o fragmento, e nenhuma linha impressa tem o token', () => {
    const h = homeCom(`${TOKEN}\n`);
    try {
      const chamadas: string[][] = [];
      const r = abrir({ home: h.home, env: { EXPEDIENTE_PORT: '4850' }, plataforma: 'darwin', executar: (c, a) => (chamadas.push([c, ...a]), 0) });
      expect(r.codigo).toBe(0);
      expect(chamadas).toEqual([['open', `http://localhost:4850/#t=${TOKEN}`]]);
      expect(r.linhas.join('\n')).not.toContain(TOKEN);
      const falha = abrir({ home: h.home, env: {}, executar: () => 3 });
      expect(falha.codigo).toBe(1);
      expect(falha.linhas.join('\n')).not.toContain(TOKEN);
    } finally {
      h.limpar();
    }
  });
});

describe('abrir: o script de verdade (com um "open" falso no PATH, sem abrir navegador)', () => {
  function rodar(token: string | undefined, env: NodeJS.ProcessEnv = {}) {
    const h = homeCom(token);
    const bin = mkdtempSync(join(tmpdir(), 'expediente-bin-'));
    const registro = join(bin, 'chamadas.txt');
    for (const nome of ['open', 'xdg-open']) {
      writeFileSync(join(bin, nome), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${registro}"\n`);
      chmodSync(join(bin, nome), 0o755);
    }
    const r = spawnSync(process.execPath, [SCRIPT], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: h.home, ...env }, encoding: 'utf8' });
    let chamadas = '';
    try {
      chamadas = readFileSync(registro, 'utf8');
    } catch {
      // nada foi aberto
    }
    h.limpar();
    rmSync(bin, { recursive: true, force: true });
    return { status: r.status, saida: `${r.stdout}${r.stderr}`, chamadas };
  }

  it('com o token: sai com 0, abre a URL com o fragmento e não imprime o token', () => {
    const r = rodar(`${TOKEN}\n`, { EXPEDIENTE_PORT: '4851' });
    expect(r.status).toBe(0);
    expect(r.chamadas).toBe(`http://localhost:4851/#t=${TOKEN}\n`);
    expect(r.saida).not.toContain(TOKEN);
    expect(r.saida).toContain('http://localhost:4851');
  });

  it('sem o arquivo do token: sai com 1, não abre nada e explica', () => {
    const r = rodar(undefined);
    expect(r.status).toBe(1);
    expect(r.chamadas).toBe('');
    expect(r.saida).toContain('npm run docker:up');
  });
});
