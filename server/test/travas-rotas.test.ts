import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ler = (arquivo: string) => readFileSync(join(__dirname, '..', arquivo), 'utf8');

interface Fontes {
  app: string;
  index: string;
  delegadas: Record<string, string>;
}

const FONTES: Fontes = {
  app: ler('http/app.ts'),
  index: ler('index.ts'),
  delegadas: { 'tema.ts': ler('http/tema.ts'), 'timeline.ts': ler('http/timeline.ts'), 'stats.ts': ler('http/stats.ts') },
};

type Classe =
  | { tipo: 'leitura' }
  | { tipo: 'trava'; prova?: RegExp; noBlocoDe?: string }
  | { tipo: 'sem-trava'; motivo: string }
  | { tipo: 'delegada'; arquivo: string };

// Toda rota do handler, pelo começo do bloco dela. "trava" = age sobre sessões ou grava estado, e por isso só atende
// com a trava de publicação (o Expediente acessível apenas pelo próprio computador). "leitura" recusa qualquer método
// que não seja de leitura. "delegada" é atendida por outro arquivo, que recusa escrita antes de tudo. Rota nova entra
// aqui com a classe.
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
  "if (path === '/api/stats' || path.startsWith('/api/stats/'))": { tipo: 'delegada', arquivo: 'stats.ts' },
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

// Em cada arquivo que recebe rota delegada: onde o handler começa, o que pode vir antes da recusa de escrita e a recusa.
const DELEGADAS: Record<string, { inicio: string; antes: string[]; recusa: string }> = {
  'tema.ts': {
    inicio: '  return (req, res, url) => {',
    antes: ['const path = url.pathname;', "const isApi = path === '/api/tema';", "if (!isApi && !path.startsWith('/temas/')) return false;"],
    recusa: "if (req.method !== 'GET' && req.method !== 'HEAD') {",
  },
  'timeline.ts': {
    inicio: '  return (req, res, url) => {',
    antes: ['const path = url.pathname;', "if (path !== '/api/timeline' && !path.startsWith('/api/timeline/')) return false;", "const method = req.method ?? 'GET';"],
    recusa: "if (method !== 'GET' && method !== 'HEAD') {",
  },
  'stats.ts': {
    inicio: 'export function handleStatsRoute(',
    antes: ["const method = req.method ?? 'GET';", 'const path = url.pathname;', "if (path !== '/api/stats' && path !== '/api/stats/days') {", "send(res, 404, { error: 'rota desconhecida' });", 'return;', '}'],
    recusa: "if (method !== 'GET' && method !== 'HEAD') {",
  },
};

// O pedido em index.ts só passa pelo guard, pelo handler da API e pelo resto (estáticos): rota não nasce ali.
const PEDIDO = [
  'const url = parseUrl(req);',
  'try {',
  'if (guard(req, res)) return;',
  'if (!api(req, res, url)) fallback(req, res, url);',
  '} catch (err) {',
  'log.warn(`Erro ao responder ${req.method} ${url.pathname}: ${errMsg(err)}`);',
  "if (!res.headersSent) sendJson(res, 500, { error: 'erro interno' });",
  'else res.destroy();',
  '}',
];

const semComentario = (linhas: string[]) => linhas.map((l) => l.trim()).filter((l) => l && !l.startsWith('//'));

function entre(fonte: string, inicio: string, fim: string, onde: string): string[] {
  const linhas = fonte.split('\n');
  const a = linhas.findIndex((l) => l.startsWith(inicio));
  const b = linhas.findIndex((l, i) => i > a && l === fim);
  if (a < 0 || b < 0) throw new Error(`${onde}: trecho que começa em "${inicio.trim()}" não encontrado`);
  return linhas.slice(a + 1, b);
}

const ehInstrucao = (linha: string) => /^ {4}[^ }]/.test(linha) && !linha.trimStart().startsWith('//');
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

function delegadaRecusaAntes(fonte: string, arquivo: string): boolean {
  const d = DELEGADAS[arquivo];
  if (!d) return false;
  const linhas = fonte.split('\n');
  const inicio = linhas.findIndex((l) => l.startsWith(d.inicio));
  if (inicio < 0) return false;
  const depois = semComentario(linhas.slice(inicio + 1));
  const recusa = depois.indexOf(d.recusa);
  return recusa >= 0 && JSON.stringify(depois.slice(0, recusa)) === JSON.stringify(d.antes);
}

/** Tudo o que faria uma rota escapar da trava: lista vazia quando o código está em ordem. */
function violacoes(f: Fontes): string[] {
  const v: string[] = [];
  const corpo = entre(f.app, '  return (req, res, url) => {', '  };', 'app.ts');
  for (const l of corpo) if (/^ {4}\}./.test(l)) v.push(`instrução colada a um fechamento de bloco: ${l.trim()}`);

  const todas = corpo.filter(ehInstrucao).map((l) => l.trim());
  for (const i of todas) if (!rotaDe(i) && !PASSOS.includes(i)) v.push(`instrução sem classe: ${i}`);
  for (const cabeca of Object.keys(ROTAS)) {
    const vezes = todas.filter((i) => i.startsWith(cabeca)).length;
    if (vezes !== 1) v.push(`rota ${vezes === 0 ? 'que não existe' : 'repetida'}: ${cabeca}`);
  }
  for (const p of PASSOS) if (!todas.includes(p)) v.push(`passo que não existe: ${p}`);

  const blocos = blocosDeRota(corpo);
  for (const [cabeca, c] of Object.entries(ROTAS)) {
    const bloco = blocos.get(c.tipo === 'trava' ? (c.noBlocoDe ?? cabeca) : cabeca) ?? '';
    if (c.tipo === 'trava' && !(c.prova ?? /terminalOn\(\)/).test(bloco)) v.push(`rota sem a trava: ${cabeca}`);
    if (c.tipo === 'leitura' && (!/!isRead\b|method !== 'GET'/.test(bloco) || /['"](?:POST|PUT|PATCH|DELETE)['"]/.test(bloco))) {
      v.push(`rota de leitura que não recusa escrita: ${cabeca}`);
    }
    if (c.tipo === 'delegada' && !delegadaRecusaAntes(f.delegadas[c.arquivo] ?? '', c.arquivo)) {
      v.push(`rota delegada que atende algo antes de recusar escrita: ${c.arquivo}`);
    }
  }

  const pedido = semComentario(entre(f.index, "server.on('request', (req, res) => {", '});', 'index.ts'));
  if (JSON.stringify(pedido) !== JSON.stringify(PEDIDO) || f.index.split("server.on('request'").length !== 2) {
    v.push('o tratamento do pedido em index.ts não é só guard, API e o resto');
  }
  return v;
}

function trocar(fonte: string, alvo: string, novo: string): string {
  if (!fonte.includes(alvo)) throw new Error(`alvo da quebra não encontrado: ${alvo}`);
  return fonte.replace(alvo, novo);
}

const NOVA = "      office.setDemo(true);\n      return true;\n    }\n";
const DEMO = "    if (path === '/api/demo') {";
const naApp = (alvo: string, novo: string): Fontes => ({ ...FONTES, app: trocar(FONTES.app, alvo, novo) });
const noTema = (alvo: string, novo: string): Fontes => ({ ...FONTES, delegadas: { ...FONTES.delegadas, 'tema.ts': trocar(FONTES.delegadas['tema.ts']!, alvo, novo) } });

// Cada jeito conhecido de uma rota nova passar sem trava, aplicado a uma cópia do código.
const QUEBRAS: Record<string, () => Fontes> = {
  'rota nova com o método na condição': () => naApp(DEMO, `    if (method === 'POST' && path === '/api/novo') {\n${NOVA}${DEMO}`),
  'rota nova por regex': () => naApp(DEMO, `    if (/^\\/api\\/novo\\//.test(path)) {\n${NOVA}${DEMO}`),
  'rota delegada nova': () => naApp(DEMO, `    if (deps.extra?.(req, res, url)) return true;\n${DEMO}`),
  'rota colada ao fim do bloco anterior': () => naApp(`    }\n${DEMO}`, `    } else if (path === '/api/novo') {\n${NOVA}${DEMO}`),
  'escrita aninhada em rota de leitura': () =>
    naApp("    if (path.startsWith('/api/agents/')) {\n", "    if (path.startsWith('/api/agents/')) {\n      if (method === 'POST') {\n        office.setDemo(true);\n        return true;\n      }\n"),
  'escrita aninhada em rota de leitura, no estilo das rotas de escrita da casa': () =>
    naApp(
      "    if (path.startsWith('/api/agents/')) {\n",
      "    if (path.startsWith('/api/agents/')) {\n      if (path.endsWith('/nota')) {\n        if (method !== 'POST') methodNotAllowed(res, 'POST');\n        else office.setDemo(true);\n        return true;\n      }\n",
    ),
  'rota de leitura sem recusar escrita': () => naApp("    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n      else ", "    if (path === '/api/snapshot') {\n      "),
  'começo de rota repetido antes da rota de verdade': () => naApp("    if (path === '/api/rooms/rename') {", "    if (path === '/api/rooms/rename') return true;\n    if (path === '/api/rooms/rename') {"),
  'rota com trava sem a trava': () => {
    const [antes, bloco, depois] = FONTES.app.split(/( {4}if \(path === '\/api\/rooms\/rename'\) \{[\s\S]*?\n {4}\}\n)/);
    if (!bloco?.includes('terminalOn()')) throw new Error('bloco de renomear sala não encontrado');
    return { ...FONTES, app: `${antes}${bloco.replace('terminalOn()', 'true')}${depois}` };
  },
  'rota na delegada antes da recusa de escrita': () => noTema("    if (req.method !== 'GET' && req.method !== 'HEAD') {", "    if (path === '/api/tema/gravar') {\n      return true;\n    }\n    if (req.method !== 'GET' && req.method !== 'HEAD') {"),
  'delegada sem a recusa de escrita': () => noTema("if (req.method !== 'GET' && req.method !== 'HEAD') {", 'if (false) {'),
  'rota em index.ts, antes do handler da API': () => ({ ...FONTES, index: trocar(FONTES.index, '    if (guard(req, res)) return;\n', "    if (guard(req, res)) return;\n    if (url.pathname === '/api/novo') return;\n") }),
};

describe('toda rota que age sobre sessões ou grava estado confere a trava de publicação', () => {
  it('o código atual não tem rota fora da tabela nem rota sem a prova da classe dela', () => {
    expect(violacoes(FONTES)).toEqual([]);
  });

  it.each(Object.keys(QUEBRAS))('acusa: %s', (nome) => {
    expect(violacoes(QUEBRAS[nome]!())).not.toEqual([]);
  });
});
