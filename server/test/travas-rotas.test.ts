import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FONTE = readFileSync(join(__dirname, '../http/app.ts'), 'utf8');

type Classe =
  | { tipo: 'leitura' }
  | { tipo: 'trava'; prova?: RegExp; noBlocoDe?: string }
  | { tipo: 'sem-trava'; motivo: string };

// Toda rota do handler, pelo começo do bloco dela. "trava" = age sobre sessões ou grava estado, e por isso só atende
// com a trava de publicação (o Expediente acessível apenas pelo próprio computador). Rota nova entra aqui com a classe.
const ROTAS: Record<string, Classe> = {
  "if (path === '/api/stream')": { tipo: 'leitura' },
  "if (path === '/api/snapshot')": { tipo: 'leitura' },
  "if (path === '/api/health')": { tipo: 'leitura' },
  "if (path === '/api/versao')": { tipo: 'leitura' },
  "if (path === '/api/resumo' || path === '/api/resumo/presenca')": { tipo: 'trava' },
  "if (path === '/api/mod/summary')": { tipo: 'leitura' },
  'const terminalMatch = TERMINAL_ROUTE.exec(path)': { tipo: 'trava', prova: /!terminals\b/ },
  "if (path.startsWith('/api/sessions/'))": { tipo: 'trava' },
  "if (path === '/api/permissions' || path.startsWith('/api/permissions/'))": { tipo: 'trava' },
  'const modFocos = MOD_FOCOS_ROUTE.exec(path)': { tipo: 'trava', noBlocoDe: 'const focarMatch = FOCAR_ROUTE.exec(path)' },
  'const focoMatch = FOCO_ROUTE.exec(path)': { tipo: 'trava', noBlocoDe: 'const focarMatch = FOCAR_ROUTE.exec(path)' },
  'const focarMatch = FOCAR_ROUTE.exec(path)': { tipo: 'trava' },
  'const irMatch = IR_ROUTE.exec(path)': { tipo: 'sem-trava', motivo: 'GET; o 302 para o app exige o nonce de uso único e Sec-Fetch-Site de dentro' },
  'const characterMatch = CHARACTER_ROUTE.exec(path)': { tipo: 'trava' },
  "if (path.startsWith('/api/agents/'))": { tipo: 'leitura' },
  "if (path === '/api/rooms/rename')": { tipo: 'trava' },
  "if (path === '/api/social/ritmo')": { tipo: 'trava' },
  "if (path === '/api/stats' || path.startsWith('/api/stats/'))": { tipo: 'leitura' },
  "if (path === '/api/demo')": { tipo: 'sem-trava', motivo: 'liga e desliga o modo demonstração, preferência da tela que não age sobre sessões' },
};

/** Os blocos de rota do handler, do começo de um até o começo do próximo. */
function blocosDeRota(fonte: string): Map<string, string> {
  const inicio = /^ {4}((?:if \((?:path === '\/api|path\.startsWith\('\/api)[^{]*\))|(?:const \w+ = \w+_ROUTE\.exec\(path\)))/;
  const blocos = new Map<string, string>();
  let cabeca: string | undefined;
  let linhas: string[] = [];
  for (const linha of fonte.split('\n')) {
    const m = inicio.exec(linha);
    if (m) {
      if (cabeca) blocos.set(cabeca, linhas.join('\n'));
      cabeca = m[1]!;
      linhas = [linha];
    } else if (cabeca) {
      linhas.push(linha);
    }
  }
  if (cabeca) blocos.set(cabeca, linhas.join('\n'));
  return blocos;
}

describe('toda rota que age sobre sessões ou grava estado confere a trava de publicação', () => {
  const blocos = blocosDeRota(FONTE);

  it('toda rota do handler está classificada (rota nova precisa entrar na tabela)', () => {
    const semClasse = [...blocos.keys()].filter((c) => !(c in ROTAS));
    expect(semClasse).toEqual([]);
  });

  it('a tabela só cita rotas que existem', () => {
    const inexistentes = Object.keys(ROTAS).filter((c) => !blocos.has(c));
    expect(inexistentes).toEqual([]);
  });

  it('cada rota "trava" confere a trava no próprio bloco (ou no bloco que a atende)', () => {
    const faltando = Object.entries(ROTAS)
      .filter(([, c]) => c.tipo === 'trava')
      .filter(([cabeca, c]) => {
        const k = c as Extract<Classe, { tipo: 'trava' }>;
        const corpo = blocos.get(k.noBlocoDe ?? cabeca) ?? '';
        return !(k.prova ?? /terminalOn\(\)/).test(corpo);
      })
      .map(([cabeca]) => cabeca);
    expect(faltando).toEqual([]);
  });
});
