import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getExigeProva } from '../http/prova-get';

const ler = (arquivo: string) => readFileSync(join(__dirname, '..', arquivo), 'utf8');

interface Fontes {
  app: string;
  index: string;
  guard: string;
  provaGet: string;
  autenticacao: string;
  delegadas: Record<string, string>;
}

const FONTES: Fontes = {
  app: ler('http/app.ts'),
  index: ler('index.ts'),
  guard: ler('http/guard.ts'),
  provaGet: ler('http/prova-get.ts'),
  autenticacao: ler('http/autenticacao.ts'),
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

// O que o guard faz com um pedido que não é um GET que só lê, do método até a saída de OPTIONS e do que ele devolve: o desafio (sem prova de cliente),
// o Origin, o caminho como a rota o lê, a prova do token (cobrada em todo /api/ menos na troca do bilhete, falhando fechada sem token) e o 415.
// Qualquer instrução a mais ou a menos nesse trecho derruba o teste.
const COBRANCA_DO_TOKEN = [
  "const method = req.method ?? 'GET';",
  "let url = new URL('/', 'http://localhost');",
  'try {',
  "url = new URL(req.url ?? '/', 'http://localhost');",
  '} catch {',
  '}',
  "const api = url.pathname === '/api' || url.pathname.startsWith('/api/');",
  'const rota = api ? auth.rotaDe(url.pathname) : undefined;',
  "const leitura = method === 'GET' || method === 'HEAD';",
  "if (rota === 'desafio') {",
  'if (leitura) auth.desafio(res, url);',
  "else rejectJson(res, 405, 'método não permitido');",
  'return true;',
  '}',
  'if (leitura && !(api && getExigeProva(url))) return false;',
  "const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined;",
  "if (!leitura && method !== 'OPTIONS' && !originAllowed(origin, host)) {",
  "reject(res, 403, 'Origem não permitida.');",
  'return true;',
  '}',
  "if (api && rota !== 'troca') {",
  'const lido = auth.token();',
  'if (!lido.ok) {',
  'rejectJson(res, 503, `Escrita bloqueada: ${lido.motivo}. Rode npm run docker:up (ou reinicie o servidor) na pasta do Expediente.`);',
  'return true;',
  '}',
  "if (!auth.confere(req.headers[PROVA_CABECALHO], method, req.url ?? '/', lido.chave)) {",
  "rejectJson(res, 401, 'Falta a prova do token local, ou ela está errada. Abra o escritório pelo botão do painel do /escritorio ou rode npm run abrir na pasta do Expediente.');",
  'return true;',
  '}',
  '}',
  "if (leitura || method === 'OPTIONS') return false;",
  "if (api && !isJsonContentType(req.headers['content-type'])) {",
  "reject(res, 415, 'Envie o corpo como JSON (Content-Type: application/json).');",
  'return true;',
  '}',
  'if (rota) {',
  'auth.tratar(rota, req, res);',
  'return true;',
  '}',
  'return false;',
];

// prova-get.ts inteiro, sem os comentários: os GET que mudam estado e a única exceção.
const PROVA_GET = [
  "const IR = /^\\/api\\/agentes\\/[^/]+\\/ir$/;",
  "const GET_COM_PROVA: readonly RegExp[] = [/^\\/api\\/permissions\\/[^/]+\\/wait$/, /^\\/api\\/mod\\/focos$/, IR];",
  'export function getExigeProva(url: URL): boolean {',
  "if (url.searchParams.get('abrir') === '1' && IR.test(url.pathname)) return false;",
  'return GET_COM_PROVA.some((re) => re.test(url.pathname));',
  '}',
];

// As três rotas de token, as exceções à prova do cliente, e a conferência que consome o desafio antes de comparar.
const ROTAS_DE_TOKEN = "const ROTAS: Record<string, RotaDeToken> = { '/api/token/desafio': 'desafio', '/api/token/bilhete': 'bilhete', '/api/token/troca': 'troca' };";
const CONFERE = [
  "const m = typeof cabecalho === 'string' ? PROVA_FORMATO.exec(cabecalho) : null;",
  'if (!m) return false;',
  'if (!this.desafios.consumir(m[1])) return false;',
  'return iguais(m[2], provaDoCliente(chave, m[1], metodo, caminho));',
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

const RECUSA_DE_LEITURA = /^if \((?:!isRead|method !== 'GET')\)/;

/** A primeira instrução de uma rota de leitura tem de ser a recusa; escrita condicionada à própria recusa não vale. */
function recusaVemPrimeiro(bloco: string): boolean {
  const [, primeira = '', segunda = ''] = semComentario(bloco.split('\n'));
  if (!RECUSA_DE_LEITURA.test(primeira)) return false;
  return primeira.endsWith('{') ? segunda.startsWith('methodNotAllowed(') : /\) methodNotAllowed\(/.test(primeira);
}

const citaDepsOuOffice = (bloco: string) => semComentario(bloco.split('\n')).filter((l) => /\b(?:deps|office)\./.test(l));

/** A recusa da rota delegada tem de encerrar a resposta: algum `return` entre ela e o `}` que a fecha. */
function delegadaRecusaSemReturn(fonte: string, arquivo: string): boolean {
  const d = DELEGADAS[arquivo];
  if (!d) return false;
  const linhas = fonte.split('\n');
  const depois = semComentario(linhas.slice(linhas.findIndex((l) => l.startsWith(d.inicio)) + 1));
  const recusa = depois.indexOf(d.recusa);
  if (recusa < 0) return false;
  const fecha = depois.indexOf('}', recusa);
  return !depois.slice(recusa + 1, fecha < 0 ? undefined : fecha).some((l) => l.startsWith('return'));
}

/** Tudo o que faria uma rota escapar da trava: lista vazia quando o código está em ordem. */
function violacoes(f: Fontes): string[] {
  const v: string[] = [];
  const corpo = entre(f.app, '  return (req, res, url) => {', '  };', 'app.ts');
  for (const l of corpo) if (/^ {4}\}./.test(l)) v.push(`instrução colada a um fechamento de bloco: ${l.trim()}`);
  for (const l of corpo) {
    const recuo = /^[ \t]*/.exec(l)![0];
    if (l.trim() && (recuo.includes('\t') || recuo.length % 2)) v.push(`recuo com tab ou número ímpar de espaços, que a leitura por blocos não vê: ${l.trim()}`);
  }

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
    if (c.tipo === 'leitura' && !recusaVemPrimeiro(bloco)) v.push(`rota de leitura cuja primeira instrução não é a recusa de escrita: ${cabeca}`);
    if (c.tipo === 'sem-trava' && citaDepsOuOffice(bloco).length) v.push(`rota sem trava que cita deps ou office: ${cabeca}`);
    if (c.tipo === 'delegada' && !delegadaRecusaAntes(f.delegadas[c.arquivo] ?? '', c.arquivo)) {
      v.push(`rota delegada que atende algo antes de recusar escrita: ${c.arquivo}`);
    }
    if (c.tipo === 'delegada' && delegadaRecusaSemReturn(f.delegadas[c.arquivo] ?? '', c.arquivo)) {
      v.push(`rota delegada cuja recusa de escrita não encerra com return: ${c.arquivo}`);
    }
  }

  const guardas = semComentario(f.guard.split('\n'));
  const de = guardas.indexOf(COBRANCA_DO_TOKEN[0]!);
  const ate = guardas.lastIndexOf(COBRANCA_DO_TOKEN.at(-1)!);
  if (de < 0 || ate < 0 || JSON.stringify(guardas.slice(de, ate + 1)) !== JSON.stringify(COBRANCA_DO_TOKEN)) {
    v.push('o guard não cobra a prova do token como deve: desafio, Origin, caminho, prova (503 sem token, 401 sem prova válida), OPTIONS, 415 e as rotas de token');
  }
  if (JSON.stringify(semComentario(f.provaGet.split('\n'))) !== JSON.stringify(PROVA_GET)) {
    v.push('os GET que mudam estado (wait, focos, ir) não são os que exigem a prova, ou a exceção do /ir?abrir=1 mudou');
  }
  if (!semComentario(f.autenticacao.split('\n')).includes(ROTAS_DE_TOKEN)) v.push('as rotas de token mudaram: só /api/token/desafio, bilhete e troca, e só a troca dispensa a prova do cliente');
  const autenticacao = semComentario(f.autenticacao.split('\n'));
  const confere = autenticacao.indexOf(CONFERE[0]!);
  if (confere < 0 || JSON.stringify(autenticacao.slice(confere, confere + CONFERE.length)) !== JSON.stringify(CONFERE)) v.push('a conferência da prova não consome o desafio antes de comparar em tempo constante');
  if (!/^export const PROVA_CABECALHO = 'x-expediente-prova';$/m.test(f.autenticacao)) v.push('o cabeçalho da prova mudou');
  if (!/^const autenticacao = new Autenticacao\(lerTokenDoDono\);$/m.test(f.index) || !/^const guard = createRequestGuard\(autenticacao\);$/m.test(f.index) || !/^const lerTokenDoDono = \(\) => lerToken\(arquivoToken\);$/m.test(f.index)) {
    v.push('o guard em index.ts não recebe a autenticação com o leitor do token do dono');
  }

  const pedido = semComentario(entre(f.index, "server.on('request', (req, res) => {", '});', 'index.ts'));
  if (JSON.stringify(pedido) !== JSON.stringify(PEDIDO) || f.index.split("server.on('request'").length !== 2) {
    v.push('o tratamento do pedido em index.ts não é só guard, API e o resto');
  }
  if ((f.index.match(/['"`]request['"`]/g) ?? []).length !== 1) v.push("index.ts tem mais de um ouvinte de 'request', e só o primeiro passa pelo guard");
  return v;
}

function trocar(fonte: string, alvo: string, novo: string): string {
  if (!fonte.includes(alvo)) throw new Error(`alvo da quebra não encontrado: ${alvo}`);
  return fonte.replace(alvo, novo);
}

const NOVA = "      office.setDemo(true);\n      return true;\n    }\n";
const DEMO = "    if (path === '/api/demo') {";
const noGuard = (alvo: string, novo: string): Fontes => ({ ...FONTES, guard: trocar(FONTES.guard, alvo, novo) });
const noProvaGet = (alvo: string, novo: string): Fontes => ({ ...FONTES, provaGet: trocar(FONTES.provaGet, alvo, novo) });
const noAutenticacao = (alvo: string, novo: string): Fontes => ({ ...FONTES, autenticacao: trocar(FONTES.autenticacao, alvo, novo) });
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
  'escrita em rota de leitura condicionada à própria recusa, com method': () =>
    naApp("    if (path === '/api/snapshot') {\n", "    if (path === '/api/snapshot') {\n      if (method !== 'GET') { office.setDemo(true); return true; }\n"),
  'escrita em rota de leitura condicionada à própria recusa, com isRead': () =>
    naApp("    if (path === '/api/snapshot') {\n", "    if (path === '/api/snapshot') {\n      if (!isRead) { office.setDemo(true); return true; }\n"),
  'rota sem trava que ganha escrita': () => naApp(DEMO + '\n', DEMO + '\n      deps.renameRoom?.();\n'),
  'rota sem trava com captura que ganha escrita': () => naApp('    if (irMatch) {\n', '    if (irMatch) {\n      deps.renameRoom?.();\n'),
  'rota nova com cinco espaços de recuo': () => naApp(DEMO, `     if (path === '/api/novo') {\n${NOVA}${DEMO}`),
  'rota nova com tab no recuo': () => naApp(DEMO, `\tif (path === '/api/novo') {\n${NOVA}${DEMO}`),
  'delegada cuja recusa não devolve': () => noTema("      sendJson(res, 405, { error: 'método não permitido' });\n      return true;\n", "      sendJson(res, 405, { error: 'método não permitido' });\n"),
  'segundo ouvinte de request em index.ts': () => ({ ...FONTES, index: `${FONTES.index}\nserver.prependListener('request', () => {});\n` }),
  'começo de rota repetido antes da rota de verdade': () => naApp("    if (path === '/api/rooms/rename') {", "    if (path === '/api/rooms/rename') return true;\n    if (path === '/api/rooms/rename') {"),
  'rota com trava sem a trava': () => {
    const [antes, bloco, depois] = FONTES.app.split(/( {4}if \(path === '\/api\/rooms\/rename'\) \{[\s\S]*?\n {4}\}\n)/);
    if (!bloco?.includes('terminalOn()')) throw new Error('bloco de renomear sala não encontrado');
    return { ...FONTES, app: `${antes}${bloco.replace('terminalOn()', 'true')}${depois}` };
  },
  'rota na delegada antes da recusa de escrita': () => noTema("    if (req.method !== 'GET' && req.method !== 'HEAD') {", "    if (path === '/api/tema/gravar') {\n      return true;\n    }\n    if (req.method !== 'GET' && req.method !== 'HEAD') {"),
  'delegada sem a recusa de escrita': () => noTema("if (req.method !== 'GET' && req.method !== 'HEAD') {", 'if (false) {'),
  'guard sem a conferência da prova': () => noGuard('if (!auth.confere(', 'if (false && !auth.confere('),
  'guard que falha aberto com o servidor sem token': () => noGuard('if (!lido.ok) {', 'if (false) {'),
  'guard que deixa OPTIONS passar antes da prova': () => noGuard("if (leitura && !(api && getExigeProva(url))) return false;", "if ((leitura || method === 'OPTIONS') && !(api && getExigeProva(url))) return false;"),
  'guard que cobra a prova só em POST': () => noGuard('if (api && rota !== \'troca\') {', "if (api && rota !== 'troca' && method === 'POST') {"),
  'guard que lê o caminho sem normalizar': () => noGuard("url = new URL(req.url ?? '/', 'http://localhost');", "url = new URL('http://localhost' + (req.url ?? '/').split('?')[0]);"),
  'guard que deixa uma rota da API sem prova': () => noGuard('const rota = api ?', "if (url.pathname.startsWith('/api/mod/')) return false;\n    const rota = api ?"),
  'guard que dispensa a prova em outra rota de token': () => noGuard("if (api && rota !== 'troca') {", "if (api && rota !== 'troca' && rota !== 'bilhete') {"),
  'guard que não pergunta quais GET mudam estado': () => noGuard('if (leitura && !(api && getExigeProva(url))) return false;', 'if (leitura) return false;'),
  'guard que responde o desafio a qualquer método': () => noGuard('if (leitura) auth.desafio(res, url);', 'auth.desafio(res, url);'),
  'guard com a troca do bilhete antes do Content-Type': () => noGuard("if (api && !isJsonContentType(req.headers['content-type'])) {", "if (api && rota !== 'troca' && !isJsonContentType(req.headers['content-type'])) {"),
  'GET que muda estado sai da lista da prova': () => noProvaGet('/^\\/api\\/permissions\\/[^/]+\\/wait$/, ', ''),
  'GET de focos sai da lista da prova': () => noProvaGet('/^\\/api\\/mod\\/focos$/, ', ''),
  'o /ir sai da lista da prova': () => noProvaGet('/^\\/api\\/mod\\/focos$/, IR]', '/^\\/api\\/mod\\/focos$/]'),
  'o /ir?abrir=1 vira exceção de qualquer rota': () => noProvaGet("&& IR.test(url.pathname)) return false;", ") return false;"),
  'a lista de prova dos GET vira vazia': () => noProvaGet('return GET_COM_PROVA.some((re) => re.test(url.pathname));', 'return false;'),
  'rota de token nova sem prova': () => noAutenticacao("'/api/token/troca': 'troca' }", "'/api/token/troca': 'troca', '/api/token/novo': 'troca' }"),
  'conferência que compara antes de consumir o desafio': () => noAutenticacao('if (!this.desafios.consumir(m[1])) return false;\n    return iguais', 'return iguais'),
  'conferência com ===': () => noAutenticacao('return iguais(m[2], provaDoCliente(chave, m[1], metodo, caminho));', 'return m[2] === provaDoCliente(chave, m[1], metodo, caminho);'),
  'index.ts cria o guard sem a autenticação do dono': () => ({ ...FONTES, index: trocar(FONTES.index, 'new Autenticacao(lerTokenDoDono)', "new Autenticacao(() => ({ ok: true, token: '', chave: Buffer.alloc(0) }))") }),
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

// O que o GET de cada rota da tabela faz, lido nos handlers. 'prova' = muda ou consome estado do servidor, então exige a prova do token;
// 'le' = só lê (o GET do EventSource não manda cabeçalho, e nenhum desses muda estado). Rota nova entra aqui com os exemplos de GET dela:
// a tabela precisa ter as mesmas chaves de ROTAS, e getExigeProva tem de concordar com cada exemplo.
//   /api/permissions/:id/wait   entrega e apaga a decisão guardada para o hook e registra quem espera
//   /api/mod/focos              marca que há um mod de pé (muda o que o /ir oferece)
//   /api/agentes/:id/ir         emite um nonce e expulsa os mais antigos do agente; com abrir=1 só consome o nonce que o navegador traz
//   /api/resumo                 só lê a hora da saída (quem a grava é o POST /api/resumo/presenca)
//   /api/focos/:token           só lê o andamento
//   /api/stream, /terminal      anexam um leitor, sem mudar o escritório
const GET_DAS_ROTAS: Record<string, Array<[string, 'le' | 'prova']>> = {
  'if (deps.tema?.(req, res, url)) return true;': [['/api/tema', 'le']],
  "if (path === '/api/stream')": [['/api/stream', 'le']],
  "if (path === '/api/snapshot')": [['/api/snapshot', 'le']],
  "if (path === '/api/health')": [['/api/health', 'le']],
  "if (path === '/api/versao')": [['/api/versao', 'le']],
  "if (path === '/api/resumo' || path === '/api/resumo/presenca')": [['/api/resumo?session=s', 'le']],
  "if (path === '/api/mod/summary')": [['/api/mod/summary?session=s', 'le']],
  'const terminalMatch = TERMINAL_ROUTE.exec(path)': [['/api/agents/x/terminal', 'le']],
  "if (path.startsWith('/api/sessions/'))": [['/api/sessions/recent', 'le']],
  "if (path === '/api/permissions' || path.startsWith('/api/permissions/'))": [['/api/permissions/p1/wait?timeout=1', 'prova'], ['/api/permissions/p1', 'le']],
  'const modFocos = MOD_FOCOS_ROUTE.exec(path)': [['/api/mod/focos', 'prova']],
  'const focoMatch = FOCO_ROUTE.exec(path)': [[`/api/focos/${'a'.repeat(32)}`, 'le']],
  'const focarMatch = FOCAR_ROUTE.exec(path)': [],
  'const irMatch = IR_ROUTE.exec(path)': [['/api/agentes/x/ir', 'prova'], ['/api/agentes/x/ir?abrir=1&n=abc', 'le']],
  'const characterMatch = CHARACTER_ROUTE.exec(path)': [],
  "if (path.startsWith('/api/agents/'))": [['/api/agents/x', 'le']],
  "if (path === '/api/rooms/rename')": [],
  "if (path === '/api/social/ritmo')": [],
  "if (path === '/api/stats' || path.startsWith('/api/stats/'))": [['/api/stats', 'le']],
  "if (path === '/api/demo')": [],
  'if (deps.timeline?.(req, res, url)) return true;': [['/api/timeline/days', 'le']],
};

describe('todo GET que muda estado exige a prova', () => {
  it('a tabela do GET tem uma entrada para cada rota da tabela das rotas', () => {
    expect(Object.keys(GET_DAS_ROTAS).sort()).toEqual(Object.keys(ROTAS).sort());
  });

  it.each(Object.entries(GET_DAS_ROTAS).flatMap(([cabeca, exemplos]) => exemplos.map(([caminho, tipo]) => [cabeca, caminho, tipo] as const)))('%s: GET %s é "%s"', (_cabeca, caminho, tipo) => {
    expect(getExigeProva(new URL(caminho, 'http://x'))).toBe(tipo === 'prova');
  });
});
