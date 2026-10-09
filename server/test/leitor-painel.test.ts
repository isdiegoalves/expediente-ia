import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { argvLeitorPainel, lerPainel } from '../../mod/expediente/hooks/painel';

const SENTINELA = 'valor-sentinela';

let filho: ChildProcess;
let pid: number;

beforeAll(async () => {
  filho = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    env: { PATH: process.env.PATH ?? '', SEGREDO_TESTE: SENTINELA, ZELLIJ_PANE_ID: '7', ZELLIJ_SESSION_NAME: 'main' },
    stdio: 'ignore',
  });
  await new Promise((r) => setTimeout(r, 300));
  pid = filho.pid as number;
});

afterAll(() => {
  filho.kill();
});

function rodarLeitor(): string {
  const [cmd, ...args] = argvLeitorPainel(pid);
  return execFileSync(cmd as string, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

describe('leitor de painel', () => {
  it('processo com SEGREDO_TESTE=valor-sentinela devolve só as duas chaves ZELLIJ', () => {
    const saida = rodarLeitor();
    expect(saida.trim().split('\n').map((l) => l.split('=')[0]).sort()).toEqual(['ZELLIJ_PANE_ID', 'ZELLIJ_SESSION_NAME']);
    expect(lerPainel(saida)).toEqual({ ZELLIJ_PANE_ID: '7', ZELLIJ_SESSION_NAME: 'main' });
  });

  it('valor-sentinela não aparece em log, snapshot, resposta HTTP nem disco', () => {
    const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const saida = rodarLeitor();
    const painel = lerPainel(saida);
    const tudo = JSON.stringify([saida, painel, espioes.map((e) => e.mock.calls)]);
    espioes.forEach((e) => e.mockRestore());
    expect(tudo).not.toContain(SENTINELA);
    expect(Object.keys(painel ?? {})).toHaveLength(2);
  });

  it('a saída com variável alheia e valores fora do formato não passa pelo parser', () => {
    const suja = `SEGREDO_TESTE=${SENTINELA}\nZELLIJ_PANE_ID=7\nZELLIJ_SESSION_NAME=main\nZELLIJ_PANE_ID=../../x\n`;
    expect(JSON.stringify(lerPainel(suja))).not.toContain(SENTINELA);
    expect(lerPainel('ZELLIJ_PANE_ID=abc\nZELLIJ_SESSION_NAME=main\n')).toBeUndefined();
    expect(lerPainel('ZELLIJ_PANE_ID=3\nZELLIJ_SESSION_NAME=a b;rm\n')).toBeUndefined();
    expect(lerPainel('')).toBeUndefined();
  });
});

const padroes = [/\bps\s+-[A-Za-z]*e[A-Za-z]*\b/, /\bps\s+e{1,2}w*\b/, /\beww\b/, /\bps\b[^\n]*\s-E\b/, /\/proc\/[0-9]+\/environ/, /\benviron\b/, /\benvp\b/, /KERN_PROCARGS/];

describe('padrões do teste estático', () => {
  it.each(['ps -eww -p 1', 'ps eww -p 1', 'ps -E -p 1', 'ps -axe', 'ps -ef'])('pega %s', (s) => {
    expect(padroes.some((p) => p.test(s))).toBe(true);
  });
  it.each(['o ps recebe só -o ppid=,comm=', 'ps -o ppid=,comm= -p 1', 'ps -axo pid=,command='])('deixa passar %s', (s) => {
    expect(padroes.some((p) => p.test(s))).toBe(false);
  });
});

describe('leitura de ambiente de outro processo', () => {
  it('nenhum outro arquivo do repositório lê ambiente de processo', () => {
    const proprios = ['mod/expediente/hooks/painel.ts', 'server/test/leitor-painel.test.ts', 'mod/expediente/tests/painel.test.ts'];
    const arquivos = execFileSync('git', ['ls-files', '-z', '--', 'mod', 'server', 'shared', 'scripts', 'client/src'], { encoding: 'utf8' })
      .split('\0')
      .filter((f) => /\.(ts|tsx|mjs|js|json|sh)$/.test(f) && !proprios.includes(f));
    const achados: string[] = [];
    for (const f of arquivos) {
      const t = readFileSync(f, 'utf8');
      for (const p of padroes) if (p.test(t)) achados.push(`${f}: ${p}`);
    }
    expect(achados).toEqual([]);
  });
});
