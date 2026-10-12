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
  sse: string;
  delegadas: Record<string, string>;
}

const FONTES: Fontes = {
  app: ler('http/app.ts'),
  index: ler('index.ts'),
  guard: ler('http/guard.ts'),
  provaGet: ler('http/prova-get.ts'),
  autenticacao: ler('http/autenticacao.ts'),
  sse: ler('http/sse.ts'),
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

// Em cada arquivo que recebe rota delegada: a fábrica que devolve o handler (nada entre ela e o `return` dele), onde o handler começa, o que pode vir antes da recusa de escrita e a recusa.
const DELEGADAS: Record<string, { fabrica?: string; inicio: string; antes: string[]; recusa: string }> = {
  'tema.ts': {
    fabrica: 'export function createTemaHandler(',
    inicio: '  return (req, res, url) => {',
    antes: ['const path = url.pathname;', "const isApi = path === '/api/tema';", "if (!isApi && !path.startsWith('/temas/')) return false;"],
    recusa: "if (req.method !== 'GET' && req.method !== 'HEAD') {",
  },
  'timeline.ts': {
    fabrica: 'export function createTimelineHandler(',
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
  'if (leitura) auth.desafio(req, res, url);',
  "else rejectJson(res, 405, 'método não permitido');",
  'return true;',
  '}',
  'if (leitura && !(api && getExigeProva(url))) {',
  'auth.contaComoPagina(req, url);',
  'return false;',
  '}',
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
  if (d.fabrica) {
    const fabrica = linhas.findIndex((l) => l.startsWith(d.fabrica!));
    if (fabrica < 0 || semComentario(linhas.slice(fabrica + 1, inicio)).length) return false;
  }
  const depois = semComentario(linhas.slice(inicio + 1));
  const recusa = depois.indexOf(d.recusa);
  return recusa >= 0 && JSON.stringify(depois.slice(0, recusa)) === JSON.stringify(d.antes);
}

// O corpo inteiro, linha a linha, de cada rota de leitura: a recusa de escrita é a primeira instrução e encerra a rota, e nada além do que
// está aqui é feito. Qualquer linha a mais, a menos ou diferente (uma citação nova de deps ou office, um ajudante, outra grafia) pede olhar a rota.
const CORPO_DA_LEITURA: Record<string, string[]> = {
  "if (path === '/api/stream')": [
    "if (path === '/api/stream') {",
    "if (method !== 'GET') methodNotAllowed(res, 'GET');",
    'else hub.attach(req, res);',
    'return true;',
    '}',
  ],
  "if (path === '/api/snapshot')": [
    "if (path === '/api/snapshot') {",
    "if (!isRead) methodNotAllowed(res, 'GET');",
    'else sendJson(res, 200, hub.current());',
    'return true;',
    '}',
  ],
  "if (path === '/api/health')": [
    "if (path === '/api/health') {",
    "if (!isRead) methodNotAllowed(res, 'GET');",
    'else {',
    'sendJson(res, 200, {',
    'ok: true,',
    'version: deps.version,',
    'demo: office.isDemo(),',
    'docker: deps.inDocker,',
    'terminal: terminalOn() && !!deps.terminals,',
    'permissions: terminalOn() && !!deps.permissions,',
    "token: deps.token ? tokenNoHealth(deps.token()) : { ok: false, motivo: 'sem leitor do token' },",
    'sources: deps.sources(),',
    'accounts: accounts.entries().map((a) => ({ id: a.id, usageStatus: accounts.usageView(a.id).status })),',
    '});',
    '}',
    'return true;',
    '}',
  ],
  "if (path === '/api/versao')": [
    "if (path === '/api/versao') {",
    "if (!isRead) methodNotAllowed(res, 'GET');",
    "else if (!deps.versao) sendJson(res, 404, { error: 'rota desconhecida' });",
    "else if (!isLoopbackHost(req.headers.host)) sendJson(res, 403, { error: 'versão só pelo próprio computador (http://localhost)' });",
    'else sendJson(res, 200, deps.versao());',
    'return true;',
    '}',
  ],
  "if (path === '/api/mod/summary')": [
    "if (path === '/api/mod/summary') {",
    "if (!isRead) methodNotAllowed(res, 'GET');",
    'else {',
    "const own = { account: url.searchParams.get('account') || undefined, session: url.searchParams.get('session') || undefined };",
    'sendJson(res, 200, modSummary(hub.current(), (id) => office.has(id), deps.version, own));',
    '}',
    'return true;',
    '}',
    'const terminals = terminalOn() ? deps.terminals : undefined;',
  ],
  "if (path.startsWith('/api/agents/'))": [
    "if (path.startsWith('/api/agents/')) {",
    'if (!isRead) {',
    "methodNotAllowed(res, 'GET');",
    'return true;',
    '}',
    'let id: string;',
    'try {',
    "id = decodeURIComponent(path.slice('/api/agents/'.length));",
    '} catch {',
    "sendJson(res, 400, { error: 'id inválido' });",
    'return true;',
    '}',
    'const detail = office.detail(id);',
    'if (detail) sendJson(res, 200, detail);',
    "else sendJson(res, 404, { error: 'agente não encontrado' });",
    'return true;',
    '}',
  ],
};

// O corpo inteiro, linha a linha, de cada rota que atende sem a trava. Qualquer linha a mais ou a menos pede olhar a rota.
const CORPO_SEM_TRAVA: Record<string, string[]> = {
  'const irMatch = IR_ROUTE.exec(path)': [
    'const irMatch = IR_ROUTE.exec(path);',
    'if (irMatch) {',
    'let id: string;',
    'try {',
    'id = decodeURIComponent(irMatch[1]);',
    '} catch {',
    "sendJson(res, 400, { error: 'id inválido' });",
    'return true;',
    '}',
    'handleIrRoute(req, res, url, id, { office, nonces, modAtivo: () => focos.modAtivo() });',
    'return true;',
    '}',
  ],
  "if (path === '/api/demo')": ["if (path === '/api/demo') {", "if (method !== 'POST') methodNotAllowed(res, 'POST');", 'else handleDemo(req, res).catch((err) => fail(res, err));', 'return true;', '}'],
};

// O corpo da recusa de escrita de cada rota delegada, entre a condição e o `}`.
const CORPO_DA_RECUSA: Record<string, string[]> = {
  'tema.ts': ["res.setHeader('Allow', 'GET, HEAD');", "sendJson(res, 405, { error: 'método não permitido' });", 'return true;'],
  'timeline.ts': ["res.setHeader('Allow', 'GET');", "sendJson(res, 405, { error: 'método não permitido' });", 'return true;'],
  'stats.ts': ["res.setHeader('Allow', 'GET');", "send(res, 405, { error: 'método não permitido' });", 'return;'],
};

// O objeto passado a createApiHandler, linha a linha: o que o handler recebe (a trava, o tema, a linha do tempo) não muda de dono sem passar por aqui.
const OBJETO_DA_API = [
  'const api = createApiHandler({',
  'renameRoom: (id, name) => {',
  'const path = office.roomPath(id);',
  'if (!path) return undefined;',
  'roomAliases.set(path, name);',
  'office.refreshRoomNames();',
  'return office.roomName(id);',
  '},',
  'mudarRitmo: (ritmo) => social.mudarRitmo(ritmo),',
  'office,',
  'hub,',
  'accounts,',
  'sources: () => watcher.sources(),',
  'version: config.version,',
  'inDocker: config.inDocker,',
  'token: lerTokenDoDono,',
  'terminal: gate.on,',
  'terminals,',
  'sessions: history,',
  'timeline: createTimelineHandler({ dir: timelineDir, recording: !!timeline }),',
  'permissions: permissions ? createPermissionRoutes(permissions) : undefined,',
  'stats,',
  'resumo: { presenca, inicio: startedAt },',
  "versao: createVersaoReader(join(config.hostDir, 'versao.json'), config.version),",
  'tema: createTemaHandler(pastasDoTema, () => temas.get(), sendJson),',
  '});',
];

// Os imports de index.ts que trazem o servidor HTTP, a fábrica da API e o guard.
const IMPORTS_DO_PEDIDO = [
  "import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';",
  "import { createApiHandler, sendJson } from './http/app';",
  "import { createRequestGuard } from './http/guard';",
];

// Toda linha de index.ts que mexe no servidor HTTP.
const LINHAS_DO_SERVIDOR = [
  'const server = createServer();',
  'const vite = await createServer({',
  'server: { middlewareMode: true, ws: { server } },',
  "server.on('request', (req, res) => {",
  "server.on('error', (err: NodeJS.ErrnoException) => {",
  'server.listen(config.port, config.host, () => {',
  'server.close(() => process.exit(0));',
];

// Toda linha de index.ts que cita `api`, `guard` ou `fallback`: as definições e o uso no pedido.
const MENCOES_DO_PEDIDO: Record<string, string[]> = {
  api: ['const api = createApiHandler({', 'if (!api(req, res, url)) fallback(req, res, url);'],
  guard: ['const guard = createRequestGuard(autenticacao);', 'if (guard(req, res)) return;'],
  fallback: [
    'let fallback: (req: IncomingMessage, res: ServerResponse, url: URL) => void;',
    'fallback = (req, res) => vite.middlewares(req, res);',
    'fallback = (req, res, url) => serveStatic(req, res, url.pathname);',
    'if (!api(req, res, url)) fallback(req, res, url);',
  ],
};

const TERMINAL_ON = "const terminalOn = () => (typeof deps.terminal === 'function' ? deps.terminal() : deps.terminal === true);";

// A linha como código: sem o texto entre aspas (o que está dentro de `${…}` de um texto com crase é código e fica) e sem comentário.
const semTexto = (l: string) =>
  l
    .replace(/`(?:[^`\\]|\\.)*`/g, (t) => [...t.matchAll(/\$\{([^}]*)\}/g)].map((m) => ` ${m[1]} `).join(''))
    .replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''")
    .replace(/\/\/.*$/, '');
const semComentarioDeBloco = (texto: string) => texto.replace(/\/\*[\s\S]*?\*\//g, '');

function recusaDaDelegadaConfere(fonte: string, arquivo: string): boolean {
  const d = DELEGADAS[arquivo]!;
  const linhas = fonte.split('\n');
  const depois = semComentario(linhas.slice(linhas.findIndex((l) => l.startsWith(d.inicio)) + 1));
  const recusa = depois.indexOf(d.recusa);
  const esperado = CORPO_DA_RECUSA[arquivo]!;
  return recusa >= 0 && JSON.stringify(depois.slice(recusa + 1, recusa + 2 + esperado.length)) === JSON.stringify([...esperado, '}']);
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
    const linhas = semComentario(bloco.split('\n'));
    if (c.tipo === 'trava' && !(c.prova ?? /terminalOn\(\)/).test(semComentarioDeBloco(linhas.join('\n')).split('\n').map(semTexto).join('\n'))) v.push(`rota sem a trava (fora de comentário e de texto): ${cabeca}`);
    if (c.tipo === 'leitura' && JSON.stringify(linhas) !== JSON.stringify(CORPO_DA_LEITURA[cabeca])) v.push(`rota de leitura com corpo diferente do conferido: ${cabeca}`);
    if (c.tipo === 'sem-trava' && JSON.stringify(linhas) !== JSON.stringify(CORPO_SEM_TRAVA[cabeca])) v.push(`rota sem trava com corpo diferente do conferido: ${cabeca}`);
    if (c.tipo === 'delegada' && !delegadaRecusaAntes(f.delegadas[c.arquivo] ?? '', c.arquivo)) {
      v.push(`rota delegada que atende algo antes de recusar escrita: ${c.arquivo}`);
    }
    if (c.tipo === 'delegada' && !recusaDaDelegadaConfere(f.delegadas[c.arquivo] ?? '', c.arquivo)) {
      v.push(`rota delegada cuja recusa de escrita tem corpo diferente do conferido: ${c.arquivo}`);
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

  if (!/^const hub = new Hub\(office, \{ conta: \(req\) => autenticacao\.provou\(req\) \}\);$/m.test(f.index)) v.push('o hub em index.ts conta como página qualquer stream, e não só o que provou o token');
  if (!/this\.local\.add\(res\)/.test(f.sse) || !/isLoopbackHost\(req\.headers\.host\) && this\.conta\(req\)\) this\.local\.add\(res\);/.test(f.sse)) v.push('o hub deixou de contar só os streams que `conta` aceita');

  const pedido = semComentario(entre(f.index, "server.on('request', (req, res) => {", '});', 'index.ts'));
  if (JSON.stringify(pedido) !== JSON.stringify(PEDIDO) || f.index.split("server.on('request'").length !== 2) {
    v.push('o tratamento do pedido em index.ts não é só guard, API e o resto');
  }
  const linhasDoIndex = semComentario(semComentarioDeBloco(f.index).split('\n'));
  const codigoDoIndex = linhasDoIndex.map((l) => ({ l, codigo: semTexto(l) }));
  const servidor = codigoDoIndex.filter(({ codigo }) => /\bserver\b|createServer\(/.test(codigo)).map(({ l }) => l);
  if (JSON.stringify(servidor) !== JSON.stringify(LINHAS_DO_SERVIDOR)) {
    v.push(`index.ts mexe no servidor HTTP fora das linhas conferidas (ouvinte a mais, createServer com tratador, servidor entregue a outro módulo): ${servidor.filter((l) => !LINHAS_DO_SERVIDOR.includes(l)).join(' | ')}`);
  }
  if (codigoDoIndex.filter(({ codigo }) => codigo.includes('.listen(')).length !== 1) v.push('index.ts põe mais de um servidor para escutar (.listen)');
  const imports = linhasDoIndex.filter((l) => /^import .* from '(?:node:http|\.\/http\/app|\.\/http\/guard)';$/.test(l));
  if (JSON.stringify(imports) !== JSON.stringify(IMPORTS_DO_PEDIDO)) v.push(`index.ts importa o servidor HTTP, a fábrica da API ou o guard de outro jeito: ${imports.join(' | ')}`);
  const doObjeto = linhasDoIndex.indexOf('const api = createApiHandler({');
  const objetoDaApi = doObjeto < 0 ? [] : linhasDoIndex.slice(doObjeto, linhasDoIndex.indexOf('});', doObjeto) + 1);
  if (JSON.stringify(objetoDaApi) !== JSON.stringify(OBJETO_DA_API)) v.push(`o objeto passado a createApiHandler em index.ts mudou: ${objetoDaApi.filter((l) => !OBJETO_DA_API.includes(l)).join(' | ')}`);
  for (const [nome, esperadas] of Object.entries(MENCOES_DO_PEDIDO)) {
    const mencoes = codigoDoIndex.filter(({ codigo }) => new RegExp(`\\b${nome}\\b`).test(codigo)).map(({ l }) => l);
    if (JSON.stringify(mencoes) !== JSON.stringify(esperadas)) v.push(`index.ts cita ${nome} fora das linhas conferidas: ${mencoes.filter((l) => !esperadas.includes(l)).join(' | ')}`);
  }
  if (f.app.split(TERMINAL_ON).length !== 2 || (f.app.match(/\bterminalOn\s*=/g) ?? []).length !== 1) v.push('terminalOn não é mais a trava de publicação conferida');
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
const noIndex = (alvo: string, novo: string): Fontes => ({ ...FONTES, index: trocar(FONTES.index, alvo, novo) });
const SNAP = "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n";
const SNAP_COMPLETO = `${SNAP}      else sendJson(res, 200, hub.current());\n`;
const GUARD = 'const guard = createRequestGuard(autenticacao);';
const DEMO_ATE_RECUSA = `${DEMO}\n      if (method !== 'POST') methodNotAllowed(res, 'POST');\n`;
const naApp = (alvo: string, novo: string): Fontes => ({ ...FONTES, app: trocar(FONTES.app, alvo, novo) });
const noBlocoDeRenomear = (muda: (bloco: string) => string): Fontes => {
  const [antes, bloco, depois] = FONTES.app.split(/( {4}if \(path === '\/api\/rooms\/rename'\) \{[\s\S]*?\n {4}\}\n)/);
  return { ...FONTES, app: `${antes}${muda(bloco!)}${depois}` };
};
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
  'guard que deixa OPTIONS passar antes da prova': () => noGuard('if (leitura && !(api && getExigeProva(url))) {', "if ((leitura || method === 'OPTIONS') && !(api && getExigeProva(url))) {"),
  'guard que cobra a prova só em POST': () => noGuard('if (api && rota !== \'troca\') {', "if (api && rota !== 'troca' && method === 'POST') {"),
  'guard que lê o caminho sem normalizar': () => noGuard("url = new URL(req.url ?? '/', 'http://localhost');", "url = new URL('http://localhost' + (req.url ?? '/').split('?')[0]);"),
  'guard que deixa uma rota da API sem prova': () => noGuard('const rota = api ?', "if (url.pathname.startsWith('/api/mod/')) return false;\n    const rota = api ?"),
  'guard que dispensa a prova em outra rota de token': () => noGuard("if (api && rota !== 'troca') {", "if (api && rota !== 'troca' && rota !== 'bilhete') {"),
  'guard que não pergunta quais GET mudam estado': () => noGuard('if (leitura && !(api && getExigeProva(url))) {', 'if (leitura) {'),
  'guard que não conta o stream que provou': () => noGuard('auth.contaComoPagina(req, url);', ''),
  'guard que conta o stream de qualquer rota GET': () => noGuard('auth.contaComoPagina(req, url);', 'auth.provadas.add(req);'),
  'guard que responde o desafio a qualquer método': () => noGuard('if (leitura) auth.desafio(req, res, url);', 'auth.desafio(req, res, url);'),
  'guard com a troca do bilhete antes do Content-Type': () => noGuard("if (api && !isJsonContentType(req.headers['content-type'])) {", "if (api && rota !== 'troca' && !isJsonContentType(req.headers['content-type'])) {"),
  'GET que muda estado sai da lista da prova': () => noProvaGet('/^\\/api\\/permissions\\/[^/]+\\/wait$/, ', ''),
  'GET de focos sai da lista da prova': () => noProvaGet('/^\\/api\\/mod\\/focos$/, ', ''),
  'o /ir sai da lista da prova': () => noProvaGet('/^\\/api\\/mod\\/focos$/, IR]', '/^\\/api\\/mod\\/focos$/]'),
  'o /ir?abrir=1 vira exceção de qualquer rota': () => noProvaGet("&& IR.test(url.pathname)) return false;", ") return false;"),
  'a lista de prova dos GET vira vazia': () => noProvaGet('return GET_COM_PROVA.some((re) => re.test(url.pathname));', 'return false;'),
  'rota de token nova sem prova': () => noAutenticacao("'/api/token/troca': 'troca' }", "'/api/token/troca': 'troca', '/api/token/novo': 'troca' }"),
  'conferência que compara antes de consumir o desafio': () => noAutenticacao('if (!this.desafios.consumir(m[1])) return false;\n    return iguais', 'return iguais'),
  'conferência com ===': () => noAutenticacao('return iguais(m[2], provaDoCliente(chave, m[1], metodo, caminho));', 'return m[2] === provaDoCliente(chave, m[1], metodo, caminho);'),
  'o hub conta qualquer stream como página': () => ({ ...FONTES, index: trocar(FONTES.index, 'new Hub(office, { conta: (req) => autenticacao.provou(req) })', 'new Hub(office)') }),
  'o hub deixa de consultar `conta`': () => ({ ...FONTES, sse: trocar(FONTES.sse, ' && this.conta(req)) this.local.add(res);', ') this.local.add(res);') }),
  'index.ts cria o guard sem a autenticação do dono': () => ({ ...FONTES, index: trocar(FONTES.index, 'new Autenticacao(lerTokenDoDono)', "new Autenticacao(() => ({ ok: true, token: '', chave: Buffer.alloc(0) }))") }),
  'rota de leitura: recusa em uma linha, sem else, e a escrita logo depois': () => naApp(SNAP, `${SNAP}      handleDemo(req, res).catch((err) => fail(res, err));\n`),
  'rota de leitura: recusa em bloco sem return, e a escrita depois do bloco': () =>
    naApp(
      "    if (path.startsWith('/api/agents/')) {\n      if (!isRead) {\n        methodNotAllowed(res, 'GET');\n        return true;\n      }\n",
      "    if (path.startsWith('/api/agents/')) {\n      if (!isRead) {\n        methodNotAllowed(res, 'GET');\n      }\n      handleDemo(req, res);\n",
    ),
  'rota de leitura: recusa e escrita na mesma instrução, por vírgula': () =>
    naApp(`${SNAP}      else sendJson(res, 200, hub.current());\n`, "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET'), handleDemo(req, res);\n      else sendJson(res, 200, hub.current());\n"),
  'rota de leitura: GET que grava, no ramo else': () => naApp(`${SNAP}      else sendJson(`, `${SNAP}      else if (url.searchParams.has('demo')) office.setDemo(true);\n      else sendJson(`),
  'rota de leitura: sub-rota nova depois da recusa, sem citar método': () =>
    naApp("      const detail = office.detail(id);\n", "      if (id.endsWith('/renomear')) {\n        deps.renameRoom?.(id, url.searchParams.get('nome') ?? '');\n        return true;\n      }\n      const detail = office.detail(id);\n"),
  'rota de leitura: escrita sob cabeçalho de sobrescrita de método': () => naApp(`${SNAP}      else sendJson(`, `${SNAP}      else if (req.headers['x-http-method-override']) office.setDemo(true);\n      else sendJson(`),
  'rota de leitura: sub-rota de escrita depois da recusa, em uma linha, com o método entre aspas': () =>
    naApp(`${SNAP}      else sendJson(`, `${SNAP}      else if (url.searchParams.get('m') === 'POST') handleCharacter(req, res, 'x', 'POST').catch((err) => fail(res, err));\n      else sendJson(`),
  'rota sem trava: chama o ajudante que edita personagem': () =>
    naApp(DEMO_ATE_RECUSA, `${DEMO_ATE_RECUSA}      else if (url.searchParams.has('p')) handleCharacter(req, res, url.searchParams.get('p')!, 'PUT').catch((err) => fail(res, err));\n`),
  'rota sem trava: deps desestruturado': () => naApp(DEMO + '\n', `${DEMO}\n      const { renameRoom } = deps;\n      renameRoom?.('a', 'b');\n`),
  'rota sem trava: deps com encadeamento opcional': () => naApp(DEMO + '\n', `${DEMO}\n      deps?.renameRoom?.('a', 'b');\n`),
  'rota sem trava: deps com colchete': () => naApp(DEMO + '\n', `${DEMO}\n      deps['renameRoom']?.('a', 'b');\n`),
  'rota sem trava: ponto na linha de baixo': () => naApp(DEMO + '\n', `${DEMO}\n      deps\n        .renameRoom?.('a', 'b');\n`),
  'rota sem trava: outro objeto do fecho (focos, hub)': () => naApp('    if (irMatch) {\n', '    if (irMatch) {\n      focos.registrar(irMatch[1]);\n      hub.attach(req, res);\n'),
  'rota sem trava: sub-rota nova aninhada em /ir': () =>
    naApp('    if (irMatch) {\n', "    if (irMatch) {\n      if (url.searchParams.has('personagem')) {\n        handleCharacter(req, res, irMatch[1], 'DELETE').catch((err) => fail(res, err));\n        return true;\n      }\n"),
  'rota com trava: terminalOn() só num comentário': () => noBlocoDeRenomear((b) => b.replace('terminalOn()', 'true').replace("      if (method !== 'POST')", "      // terminalOn() não vale aqui\n      if (method !== 'POST')")),
  'rota com trava: terminalOn() só num comentário no fim da linha': () => noBlocoDeRenomear((b) => b.replace('terminalOn()', 'true // terminalOn()')),
  'rota com trava: terminalOn() só no texto do erro': () => noBlocoDeRenomear((b) => b.replace('else if (!terminalOn()) sendJson', 'else if (false) sendJson').replace('renomear salas desligado', 'renomear salas desligado, terminalOn() falso')),
  'delegada: escrita dentro da própria recusa, com return aninhado antes': () =>
    noTema(
      "    if (req.method !== 'GET' && req.method !== 'HEAD') {\n",
      "    if (req.method !== 'GET' && req.method !== 'HEAD') {\n      if (path !== '/api/tema/aplicar') {\n        sendJson(res, 405, { error: 'método não permitido' });\n        return true;\n      }\n      gravarTemaAtivo(url.searchParams.get('id'));\n",
    ),
  'delegada: return só num ramo da recusa': () =>
    noTema("      sendJson(res, 405, { error: 'método não permitido' });\n      return true;\n", "      sendJson(res, 405, { error: 'método não permitido' });\n      if (path !== '/api/tema/aplicar') return true;\n"),
  'delegada: recusa do timeline ganha escrita antes do return': () => ({
    ...FONTES,
    delegadas: { ...FONTES.delegadas, 'timeline.ts': trocar(FONTES.delegadas['timeline.ts']!, "      sendJson(res, 405, { error: 'método não permitido' });\n", "      sendJson(res, 405, { error: 'método não permitido' });\n      gravar(url);\n") },
  }),
  'index: createServer já recebe um tratador': () => noIndex('const server = createServer();', 'const server = createServer((req, res) => extra(req, res));'),
  'index: ouvinte de upgrade': () => noIndex("server.on('error'", "server.on('upgrade', (req, socket) => extra(req, socket));\nserver.on('error'"),
  'index: nome do evento por constante': () => noIndex("server.on('error'", "const EVENTO = ['re', 'quest'].join('');\nserver.prependListener(EVENTO, (req, res) => extra(req, res));\nserver.on('error'"),
  'index: servidor entregue a outro módulo': () => noIndex("server.on('error'", "anexarExtras(server);\nserver.on('error'"),
  'index: segundo servidor em outra porta': () => noIndex("server.on('error'", "createServer((req, res) => extra(req, res)).listen(config.port + 1, '0.0.0.0');\nserver.on('error'"),
  'index: api embrulhada antes do pedido': () => ({
    ...FONTES,
    index: trocar(trocar(FONTES.index, 'const api = createApiHandler({', 'const apiDeVerdade = createApiHandler({'), 'const guard = createRequestGuard(autenticacao);', 'const guard = createRequestGuard(autenticacao);\nconst api = (req: IncomingMessage, res: ServerResponse, url: URL) => extra(req, res, url) || apiDeVerdade(req, res, url);'),
  }),
  'index: guard trocado por um que deixa passar': () => noIndex('const guard = createRequestGuard(autenticacao);', 'const guard = (req: IncomingMessage, res: ServerResponse) => (req.url?.startsWith("/api/novo") ? false : createRequestGuard(autenticacao)(req, res));'),
  'index: fallback de produção atende rota nova': () => noIndex('  fallback = (req, res, url) => serveStatic(req, res, url.pathname);', "  fallback = (req, res, url) => (url.pathname === '/novo' ? extra(req, res) : serveStatic(req, res, url.pathname));"),
  'delegada: rota nova no mesmo teste de entrada, antes da recusa': () => noTema("const isApi = path === '/api/tema';", "const isApi = path === '/api/tema' || path === '/api/tema/aplicar';"),
  'app: rota pendurada no passo que recusa o que não é /api': () =>
    naApp("    if (path !== '/api' && !path.startsWith('/api/')) return false;", "    if (path !== '/api' && !path.startsWith('/api/')) return false; else if (path === '/api/novo') return (office.setDemo(true), true);"),
  'app: condição de rota em duas linhas, com a continuação recuada': () =>
    naApp(`${DEMO}\n`, "    if (path === '/api/demo' ||\n      (path === '/api/novo' && (office.setDemo(true), true))) {\n"),
  'leitura: `else void 0;` satisfaz a regra e a escrita vem na linha seguinte, por ajudante do fecho': () => naApp(SNAP_COMPLETO, "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n      else void 0;\n      handleCharacter(req, res, url.searchParams.get('p') ?? '', method).catch((err) => fail(res, err));\n"),
  'leitura: GET que grava por ajudante do fecho (handleDemo), sem citar deps nem office': () => naApp(SNAP_COMPLETO, "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n      else if (url.searchParams.has('demo')) handleDemo(req, res).catch((err) => fail(res, err));\n      else sendJson(res, 200, hub.current());\n"),
  'leitura: deps desestruturado dentro do bloco': () => naApp(SNAP_COMPLETO, "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n      else if (url.searchParams.has('n')) {\n        const { renameRoom } = deps;\n        renameRoom?.('a', 'b');\n      }\n      else sendJson(res, 200, hub.current());\n"),
  'leitura: deps com colchete e crase': () => naApp(SNAP_COMPLETO, "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n      else if (url.searchParams.has('n')) deps[`renameRoom`]?.('a', 'b');\n      else sendJson(res, 200, hub.current());\n"),
  'leitura: Reflect.get(deps, ...)': () => naApp(SNAP_COMPLETO, "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n      else if (url.searchParams.has('n')) Reflect.get(deps, 'renameRoom')?.('a', 'b');\n      else sendJson(res, 200, hub.current());\n"),
  'leitura: deps! (não nulo do TypeScript) antes do ponto': () => naApp(SNAP_COMPLETO, "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n      else if (url.searchParams.has('n')) deps!.renameRoom?.('a', 'b');\n      else sendJson(res, 200, hub.current());\n"),
  'leitura: office por apelido (const o = office)': () => naApp(SNAP_COMPLETO, "    if (path === '/api/snapshot') {\n      if (!isRead) methodNotAllowed(res, 'GET');\n      else if (url.searchParams.has('n')) {\n        const o = office;\n        o.setDemo(true);\n      }\n      else sendJson(res, 200, hub.current());\n"),
  'trava: terminalOn() só em comentário de bloco': () => noBlocoDeRenomear((b) => b.replace('else if (!terminalOn()) sendJson', 'else if (false /* !terminalOn() */) sendJson')),
  'trava: terminalOn() só em linha de comentário com asterisco': () => noBlocoDeRenomear((b) => b.replace('else if (!terminalOn()) sendJson', 'else if (false) sendJson').replace("      if (method !== 'POST')", "      /*\n       * terminalOn() não vale aqui\n       */\n      if (method !== 'POST')")),
  'index: deps.tema embrulhado na montagem da API': () => noIndex('  tema: createTemaHandler(pastasDoTema, () => temas.get(), sendJson),', '  tema: (req, res, url) => rotaNova(req, res, url) || createTemaHandler(pastasDoTema, () => temas.get(), sendJson)(req, res, url),'),
  'tema.ts: outro tratador devolvido antes do conferido': () => noTema('  return (req, res, url) => {', "  if (pastas.hostDir) return (req, res, url) => (url.pathname === '/api/tema/aplicar' ? (gravar(url), true) : false);\n  return (req, res, url) => {"),
  'index: segundo servidor por import com outro nome': () => ({ ...FONTES, index: trocar(trocar(FONTES.index, "import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';", "import { createServer, createServer as criar, type IncomingMessage, type ServerResponse } from 'node:http';"), "server.on('error'", "criar((req, res) => extra(req, res)).listen(config.port + 1, '0.0.0.0');\nserver.on('error'") }),
  'index: new Server(...) do node:http': () => noIndex("server.on('error'", "new Server((req, res) => extra(req, res)).listen(config.port + 1, '0.0.0.0');\nserver.on('error'"),
  'index: linha que começa com log. e mexe no servidor': () => noIndex("server.on('error'", "log.info('extra'), server.prependListener('request', (req, res) => extra(req, res));\nserver.on('error'"),
  'index: ouvinte registrado dentro de um texto com crase': () => noIndex("server.on('error'", "void `${server.prependListener('request', (req, res) => extra(req, res))}`;\nserver.on('error'"),
  'index: fallback trocado por desestruturação': () => noIndex(GUARD, `${GUARD}\nconst antigo = fallback;\n[fallback] = [(req, res, url) => (url.pathname === '/novo' ? extra(req, res) : antigo(req, res, url))];`),
  'index: createApiHandler sombreado por import com outro nome': () => ({ ...FONTES, index: trocar(trocar(FONTES.index, "import { createApiHandler, sendJson } from './http/app';", "import { createApiHandler as criarApi, sendJson } from './http/app';"), 'const api = createApiHandler({', "const createApiHandler = (d: Parameters<typeof criarApi>[0]) => { const h = criarApi(d); return (req: IncomingMessage, res: ServerResponse, url: URL) => extra(req, res, url) || h(req, res, url); };\nconst api = createApiHandler({") }),
  'index: a trava de publicação entregue como sempre ligada': () => ({ ...FONTES, index: FONTES.index.replace(/^  terminal: gate\.on,$/gm, '  terminal: true,') }),
  'index: deps.timeline embrulhado': () => noIndex('  timeline: createTimelineHandler({ dir: timelineDir, recording: !!timeline }),', '  timeline: (req, res, url) => rotaNova(req, res, url) || createTimelineHandler({ dir: timelineDir, recording: !!timeline })(req, res, url),'),
  'leitura: escrita com o método em crase (sem aspas)': () => naApp("      const detail = office.detail(id);\n", "      if (req.headers.x === `1`) return (handleCharacter(req, res, id, `PUT`).catch((err) => fail(res, err)), true);\n      const detail = office.detail(id);\n"),
  'app: terminalOn passa a valer sempre': () => naApp(TERMINAL_ON, 'const terminalOn = () => true;'),
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
//   /api/stream                 anexa um leitor, sem mudar o escritório e sem exigir prova (o EventSource não manda cabeçalho). A prova que ele
//                               pode trazer na query (`?prova=`, de uso único) só muda a contagem de páginas abertas que o registro de
//                               permissões usa para desviar o pedido; stream sem prova (ou com prova ruim) é atendido e não conta
//   /terminal                   anexa um leitor, sem mudar o escritório
const GET_DAS_ROTAS: Record<string, Array<[string, 'le' | 'prova']>> = {
  'if (deps.tema?.(req, res, url)) return true;': [['/api/tema', 'le']],
  "if (path === '/api/stream')": [['/api/stream', 'le'], ['/api/stream?prova=a.b', 'le']],
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
