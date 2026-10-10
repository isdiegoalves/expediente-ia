import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const FONTE = readFileSync(join(__dirname, '../http/app.ts'), 'utf8');

type Classe =
  | { tipo: 'leitura' }
  | { tipo: 'trava'; prova?: RegExp; noBlocoDe?: string }
  | { tipo: 'sem-trava'; motivo: string }
  | { tipo: 'delegada'; arquivo: string };

// Toda rota do handler, pelo começo do bloco dela. "trava" = age sobre sessões ou grava estado, e por isso só atende
// com a trava de publicação (o Expediente acessível apenas pelo próprio computador). Rota nova entra aqui com a classe.
const ROTAS: Record<string, Classe> = {
  'if (deps.tema?.(req, res, url)) return true;': { tipo: 'delegada', arquivo: 'tema.ts' },
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
  'if (deps.timeline?.(req, res, url)) return true;': { tipo: 'delegada', arquivo: 'timeline.ts' },
};

// O resto das instruções de primeiro nível do handler: preparação, o miolo dos blocos acima e o 404 final. Uma
// instrução nova que não esteja aqui nem em ROTAS derruba o teste, qualquer que seja o feitio dela.
const PASSOS = [
  'const path = url.pathname;',
  "if (path !== '/api' && !path.startsWith('/api/')) return false;",
  "const method = req.method ?? 'GET';",
  "const isRead = method === 'GET' || method === 'HEAD';",
  'const terminals = terminalOn() ? deps.terminals : undefined;',
  'if (terminalMatch) {',
  'if ((modFocos || focoMatch || focarMatch) && !terminalOn()) {',
  'if (modFocos) {',
  'if (focoMatch) {',
  'if (focarMatch) {',
  'if (irMatch) {',
  'if (characterMatch) {',
  "sendJson(res, 404, { error: 'rota desconhecida' });",
  'return true;',
];

/** As linhas do corpo do handler devolvido por createApiHandler. */
function corpoDoHandler(fonte: string): string[] {
  const linhas = fonte.split('\n');
  const inicio = linhas.findIndex((l) => l === '  return (req, res, url) => {');
  const fim = linhas.findIndex((l, i) => i > inicio && l === '  };');
  if (inicio < 0 || fim < 0) throw new Error('handler de createApiHandler não encontrado em app.ts');
  return linhas.slice(inicio + 1, fim);
}

const ehInstrucao = (linha: string) => /^ {4}[^ }]/.test(linha) && !linha.trimStart().startsWith('//');

/** O começo de cada instrução de primeiro nível do handler (sem comentários). */
const instrucoes = (corpo: string[]) => corpo.filter(ehInstrucao).map((l) => l.trim());

const rotaDe = (instrucao: string) => Object.keys(ROTAS).find((cabeca) => instrucao.startsWith(cabeca));

/** Os blocos de rota do handler, do começo de um até o começo do próximo. */
function blocosDeRota(corpo: string[]): Map<string, string> {
  const blocos = new Map<string, string>();
  let cabeca: string | undefined;
  let linhas: string[] = [];
  for (const linha of corpo) {
    const rota = ehInstrucao(linha) ? rotaDe(linha.trim()) : undefined;
    if (rota) {
      if (cabeca) blocos.set(cabeca, linhas.join('\n'));
      cabeca = rota;
      linhas = [linha];
    } else if (cabeca) {
      linhas.push(linha);
    }
  }
  if (cabeca) blocos.set(cabeca, linhas.join('\n'));
  return blocos;
}

describe('toda rota que age sobre sessões ou grava estado confere a trava de publicação', () => {
  const corpo = corpoDoHandler(FONTE);
  const blocos = blocosDeRota(corpo);

  it('toda instrução de primeiro nível do handler é uma rota classificada ou um passo conhecido', () => {
    const semClasse = instrucoes(corpo).filter((i) => !rotaDe(i) && !PASSOS.includes(i));
    expect(semClasse).toEqual([]);
  });

  it('a tabela só cita rotas e passos que existem', () => {
    const todas = instrucoes(corpo);
    const rotasInexistentes = Object.keys(ROTAS).filter((c) => !blocos.has(c));
    const passosInexistentes = PASSOS.filter((p) => !todas.includes(p));
    expect([...rotasInexistentes, ...passosInexistentes]).toEqual([]);
  });

  it('cada rota "trava" confere a trava no próprio bloco (ou no bloco que a atende)', () => {
    const faltando = Object.entries(ROTAS)
      .filter(([, c]) => c.tipo === 'trava')
      .filter(([cabeca, c]) => {
        const k = c as Extract<Classe, { tipo: 'trava' }>;
        const corpoDoBloco = blocos.get(k.noBlocoDe ?? cabeca) ?? '';
        return !(k.prova ?? /terminalOn\(\)/).test(corpoDoBloco);
      })
      .map(([cabeca]) => cabeca);
    expect(faltando).toEqual([]);
  });

  it('cada rota delegada só atende leitura (GET e HEAD) no arquivo que a recebe', () => {
    const escrevem = Object.values(ROTAS)
      .filter((c): c is Extract<Classe, { tipo: 'delegada' }> => c.tipo === 'delegada')
      .filter((c) => {
        const fonte = readFileSync(join(__dirname, '../http', c.arquivo), 'utf8');
        return !/(req\.)?method !== 'GET' && (req\.)?method !== 'HEAD'/.test(fonte);
      })
      .map((c) => c.arquivo);
    expect(escrevem).toEqual([]);
  });
});
