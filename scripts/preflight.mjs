#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORTA = 4848;
const BASE = `http://127.0.0.1:${PORTA}`;
const PLUGINS = ['mod/expediente', 'mod/expediente-permissoes'];
const PADRAO_ID_DE_SESSAO = /\b(?:B-\d{2}|R\d-\d{2}|F1?-\d{2}|N-\d{2}|HS-\d{2}|HC-\d{2}|E-\d{2}|C-\d{2}|G\d(?:\.[a-z])?)\b/;
const TIPOS_DO_MOD = 'mod/expediente/.claude-plugin/types/claude-code/index.d.ts';
const PADRAO_TRAILER = /^co-authored-by:/im;
const TERMO_PROIBIDO = ['dev', 'mods'].join('-');

export function portasForaDoLoopback(configJson) {
  const config = typeof configJson === 'string' ? JSON.parse(configJson) : configJson;
  const falhas = [];
  for (const [servico, def] of Object.entries(config.services ?? {})) {
    for (const porta of def.ports ?? []) {
      if (porta.host_ip !== '127.0.0.1') {
        falhas.push(`${servico}: ${porta.published ?? '?'}:${porta.target ?? '?'} com host_ip ${porta.host_ip ?? '(ausente)'}`);
      }
    }
  }
  return falhas;
}

export function escutasForaDoLoopback(saidaLsof) {
  const escutas = saidaLsof.split('\n').filter((l) => l.includes('(LISTEN)'));
  if (escutas.length === 0) return ['nada escutando'];
  return escutas.filter((l) => !/\s127\.0\.0\.1:\d+\s+\(LISTEN\)/.test(l));
}

export function mensagensComTrailer(mensagens) {
  return mensagens.filter((m) => PADRAO_TRAILER.test(m));
}

export function mensagensComIdDeSessao(mensagens) {
  return mensagens.filter((m) => PADRAO_ID_DE_SESSAO.test(m));
}

export function versaoDosTipos(texto) {
  return /^\/\/ Written by Claude Code (\S+)\./m.exec(texto.split('\n', 3).join('\n'))?.[1] ?? null;
}

export function versaoDoClaude(saida) {
  return /^(\d+\.\d+\.\d+)/.exec(saida.trim())?.[1] ?? null;
}

export function caminhosDeRegistro(arquivos) {
  return arquivos.filter((a) => /(^|\/)(\.docs-arquivo|\.playwright-mcp)(\/|$)/.test(a));
}

const TETO_DO_MOD_MS = 1000;

const tetoDe = (r) => r.teto ?? r.limite / 2;

export function testesAcimaDoTeto(registros) {
  return registros.filter((r) => r.duracao > tetoDe(r));
}

export function temposDoPluginTest(saida) {
  const registros = [];
  let arquivo = '';
  for (const linha of saida.split('\n')) {
    const cabecalho = /^(tests\/\S+\.test\.tsx?):$/.exec(linha);
    if (cabecalho) arquivo = cabecalho[1];
    const teste = /^\(pass\) (.+) \[([\d.]+)ms\]$/.exec(linha);
    if (teste) registros.push({ arquivo, nome: teste[1], duracao: Number(teste[2]), limite: 5000, teto: TETO_DO_MOD_MS });
  }
  return registros;
}

export function veredictoDeTempo(lentos, isolados) {
  const falhas = [];
  const avisos = [];
  for (const t of lentos) {
    const sozinho = isolados.get(t.nome);
    const linha = `${t.nome} (${t.arquivo}): ${Math.round(t.duracao)} ms na suíte, ${sozinho === undefined ? 'sem medida isolada' : `${Math.round(sozinho)} ms isolado`}, teto ${tetoDe(t)} ms`;
    if (sozinho === undefined || sozinho > tetoDe(t)) falhas.push(linha);
    else avisos.push(linha);
  }
  return { falhas, avisos };
}

function rodar(cmd, args, env) {
  const r = spawnSync(cmd, args, { cwd: RAIZ, encoding: 'utf8', env: env ? { ...process.env, ...env } : process.env });
  return {
    status: r.error ? -1 : r.status,
    stdout: r.stdout ?? '',
    saida: `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? String(r.error) : ''}`,
  };
}

const ok = (detalhe = '') => ({ ok: true, detalhe });
const falha = (detalhe) => ({ ok: false, detalhe });
const pular = (aviso) => ({ pulado: true, detalhe: aviso });

function comandoSimples(cmd, args, env) {
  const r = rodar(cmd, args, env);
  return r.status === 0 ? ok() : falha(`${cmd} ${args.join(' ')} saiu com ${r.status}\n${r.saida.slice(-2000)}`);
}

function mensagensDaFeature() {
  const r = rodar('git', ['log', 'main..HEAD', '--format=%B%x00']);
  if (r.status !== 0) throw new Error(`git log falhou: ${r.saida}`);
  return r.stdout.split('\0').map((m) => m.trim()).filter(Boolean);
}

async function http(metodo, caminho, corpo) {
  try {
    const res = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: corpo ? { 'Content-Type': 'application/json' } : {},
      body: corpo ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    return res.status;
  } catch (e) {
    return `erro: ${e.message}`;
  }
}

function tiposDaInstalacao(versao) {
  const base = resolve('/tmp', `claude-${process.getuid()}`, 'bundled-skills', versao);
  if (!existsSync(base)) return null;
  for (const hash of readdirSync(base)) {
    const fonte = resolve(base, hash, 'plugin-authoring/types/claude-code.d.ts');
    if (existsSync(fonte)) return fonte;
  }
  return null;
}

function checarTiposDoMod() {
  const arquivo = resolve(RAIZ, TIPOS_DO_MOD);
  const instalada = versaoDoClaude(rodar('claude', ['--version']).stdout);
  if (!instalada) return falha('claude --version não respondeu uma versão');
  const fonte = tiposDaInstalacao(instalada);
  if (fonte) {
    mkdirSync(dirname(arquivo), { recursive: true });
    copyFileSync(fonte, arquivo);
  } else if (!existsSync(arquivo)) {
    return falha(`tipos da ${instalada} não achados em /tmp/claude-<uid>/bundled-skills/${instalada}/*/plugin-authoring/types/ nem em ${TIPOS_DO_MOD}: abra uma sessão do Claude Code ${instalada} uma vez (ela extrai as skills empacotadas) e rode o pré-voo de novo`);
  }
  const dosTipos = versaoDosTipos(readFileSync(arquivo, 'utf8'));
  if (!dosTipos || dosTipos !== instalada) {
    return falha(`tipos escritos pela versão ${dosTipos ?? '?'} do Claude Code, instalada ${instalada}: apague ${TIPOS_DO_MOD} e abra uma sessão do ${instalada} para extrair os da instalação`);
  }
  const mod = resolve(RAIZ, 'mod/expediente');
  const tsconfig = resolve(mkdtempSync(resolve(tmpdir(), 'preflight-tsc-')), 'tsconfig.json');
  writeFileSync(tsconfig, JSON.stringify({
    compilerOptions: {
      target: 'es2023', lib: ['es2023'], types: [], module: 'esnext', moduleResolution: 'bundler',
      strict: true, noUncheckedIndexedAccess: true, noEmit: true, skipLibCheck: true,
      jsx: 'react', jsxFactory: 'h', jsxFragmentFactory: 'Fragment',
    },
    include: [resolve(mod, '.claude-plugin/types'), resolve(mod, 'hooks'), resolve(mod, 'tests')],
  }));
  const r = comandoSimples('npx', ['tsc', '-p', tsconfig]);
  return r.ok ? ok(`tsc do mod contra os tipos da ${dosTipos}`) : r;
}

export function opcoesDe(argv) {
  return { comContainer: argv.includes('--com-container'), comNavegador: argv.includes('--com-navegador') };
}

export function mensagemFinal(opcoes) {
  const faltam = [opcoes.comContainer ? null : '--com-container', opcoes.comNavegador ? null : '--com-navegador'].filter(Boolean);
  return faltam.length ? `pré-voo verde (sem ${faltam.join(' nem ')}: a fatia ainda não fecha)` : 'pré-voo verde';
}

export async function etapaNavegador(opcoes) {
  if (!opcoes.comNavegador) {
    return pular('sem --com-navegador: a fatia não fecha sem esta etapa');
  }
  const build = comandoSimples('npm', ['run', 'build:client']);
  if (!build.ok) return build;
  const r = comandoSimples('node', ['scripts/prova-maquete.mjs']);
  return r.ok ? ok('roteiro do modo maquete verde no Chromium headless') : r;
}

const REPORTER_DE_TEMPOS = './scripts/reporter-tempos.mjs';
let registrosDeTempo = [];

function medirTestes(extra, saida) {
  rmSync(saida, { force: true });
  const r = comandoSimples('npx', ['vitest', 'run', ...extra, '--reporter=default', `--reporter=${REPORTER_DE_TEMPOS}`], { EXPEDIENTE_TEMPOS_SAIDA: saida });
  if (!r.ok) return { r, registros: [] };
  return { r, registros: JSON.parse(readFileSync(saida, 'utf8')) };
}

function medirIsolados(lentos, saida) {
  const isolados = new Map();
  const porArquivo = Map.groupBy(lentos, (t) => t.arquivo);
  for (const [arquivo, testes] of porArquivo) {
    const padrao = `^(?:${testes.map((t) => t.nome.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`;
    const { registros } = medirTestes([relative(RAIZ, arquivo), '-t', padrao], saida);
    for (const g of registros) isolados.set(g.nome, g.duracao);
  }
  return isolados;
}

const etapas = [
  {
    nome: 'typecheck, testes e teste do pré-voo',
    async rodar() {
      const tipos = comandoSimples('npm', ['run', 'typecheck']);
      if (!tipos.ok) return tipos;
      const { r, registros } = medirTestes([], resolve(mkdtempSync(resolve(tmpdir(), 'preflight-tempos-')), 'tempos.json'));
      if (!r.ok) return r;
      registrosDeTempo = registros;
      const t = comandoSimples('node', ['--test', 'scripts/preflight.test.mjs']);
      if (!t.ok) return t;
      return ok('typecheck, vitest e node:test verdes');
    },
  },
  {
    nome: 'tempo dos testes',
    async rodar() {
      const lentos = testesAcimaDoTeto(registrosDeTempo);
      if (lentos.length === 0) return ok(`${registrosDeTempo.length} testes, nenhum acima da metade do limite`);
      const saida = resolve(mkdtempSync(resolve(tmpdir(), 'preflight-isolados-')), 'tempos.json');
      const { falhas, avisos } = veredictoDeTempo(lentos, medirIsolados(lentos, saida));
      if (falhas.length) return falha(`teste acima da metade do limite também isolado:\n${falhas.join('\n')}`);
      return ok(`${registrosDeTempo.length} testes; AVISO, só passaram da metade do limite sob a carga do momento:\n${avisos.join('\n')}`);
    },
  },
  {
    nome: 'plugins do Claude Code',
    async rodar() {
      for (const alvo of ['.', ...PLUGINS]) {
        const r = comandoSimples('claude', ['plugin', 'validate', '--strict', alvo]);
        if (!r.ok) return r;
      }
      if (!existsSync(resolve(RAIZ, 'mod/expediente/tests'))) {
        return ok('validate --strict verde; mod/expediente/tests não existe, plugin test pulado (aviso)');
      }
      const t = rodar('claude', ['plugin', 'test', 'mod/expediente']);
      if (t.status !== 0) return falha(`claude plugin test mod/expediente saiu com ${t.status}\n${t.saida.slice(-2000)}`);
      const lentos = testesAcimaDoTeto(temposDoPluginTest(t.saida));
      let aviso = '';
      if (lentos.length) {
        const repeticao = rodar('claude', ['plugin', 'test', 'mod/expediente']);
        const isolados = new Map(temposDoPluginTest(repeticao.saida).map((g) => [g.nome, g.duracao]));
        const { falhas, avisos } = veredictoDeTempo(lentos, isolados);
        if (falhas.length) return falha(`teste do mod acima do teto também na repetição:\n${falhas.join('\n')}`);
        aviso = `; AVISO, teste do mod acima do teto só sob a carga do momento:\n${avisos.join('\n')}`;
      }
      const tipos = checarTiposDoMod();
      return tipos.ok ? ok(`validate --strict, plugin test e ${tipos.detalhe} verdes${aviso}`) : tipos;
    },
  },
  {
    nome: 'tema',
    async rodar() {
      if (!existsSync(resolve(RAIZ, 'scripts/preflight-tema.mjs'))) {
        return pular('scripts/preflight-tema.mjs ainda não existe');
      }
      return comandoSimples('node', ['scripts/preflight-tema.mjs']);
    },
  },
  {
    nome: 'modo maquete no navegador',
    rodar: etapaNavegador,
  },
  {
    nome: 'container',
    async rodar(opcoes) {
      if (!opcoes.comContainer) {
        return pular('sem --com-container: a fatia não fecha sem esta etapa');
      }
      const cfg = rodar('docker', ['compose', 'config', '--format', 'json']);
      if (cfg.status !== 0) return falha(`docker compose config falhou\n${cfg.saida.slice(-1000)}`);
      const fora = portasForaDoLoopback(cfg.stdout);
      if (fora.length) return falha(`portas fora de 127.0.0.1:\n${fora.join('\n')}`);

      const lsof = rodar('lsof', ['-nP', `-iTCP:${PORTA}`, '-sTCP:LISTEN']);
      const escutas = escutasForaDoLoopback(lsof.saida);
      if (escutas.length) return falha(`${PORTA} fora do loopback ou parada:\n${escutas.join('\n')}`);

      const saude = await http('GET', '/api/health');
      if (saude !== 200) return falha(`GET /api/health respondeu ${saude}`);

      const hook = await http('POST', '/api/permissions', {
        session_id: 'preflight',
        hook_event_name: 'PermissionRequest',
        tool_name: 'Bash',
        tool_input: { command: 'true' },
      });
      if (hook === 403 || hook === 404 || typeof hook !== 'number') {
        return falha(`POST /api/permissions respondeu ${hook}`);
      }
      return ok(`compose só em 127.0.0.1, ${PORTA} só em loopback, health 200, permissions ${hook}`);
    },
  },
  {
    nome: 'higiene',
    async rodar() {
      const grep = rodar('git', ['grep', '-n', '-e', TERMO_PROIBIDO]);
      if (grep.status === 0) return falha(`"${TERMO_PROIBIDO}" versionado:\n${grep.saida}`);
      if (grep.status !== 1) return falha(`git grep falhou: ${grep.saida}`);

      const mensagens = mensagensDaFeature();
      const trailers = mensagensComTrailer(mensagens);
      if (trailers.length) return falha(`Co-Authored-By em:\n${trailers.join('\n---\n')}`);
      const ids = mensagensComIdDeSessao(mensagens);
      if (ids.length) return falha(`ID de sessão em mensagem de commit:\n${ids.join('\n---\n')}`);

      const ls = rodar('git', ['ls-files']);
      const registro = caminhosDeRegistro(ls.stdout.split('\n'));
      if (registro.length) return falha(`registro de sessão versionado:\n${registro.join('\n')}`);
      return ok(`${mensagens.length} commit(s) limpos, nenhum caminho de registro versionado`);
    },
  },
];

export async function main(argv) {
  const opcoes = opcoesDe(argv);
  for (const [i, etapa] of etapas.entries()) {
    const rotulo = `${i + 1}. ${etapa.nome}`;
    const r = await etapa.rodar(opcoes);
    if (r.pulado) {
      console.log(`AVISO  ${rotulo}: pulado (${r.detalhe})`);
    } else if (r.ok) {
      console.log(`OK     ${rotulo}${r.detalhe ? `: ${r.detalhe}` : ''}`);
    } else {
      console.log(`FALHOU ${rotulo}\n${r.detalhe}`);
      return 1;
    }
  }
  console.log(mensagemFinal(opcoes));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
