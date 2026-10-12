import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caminhosDeRegistro,
  escutasForaDoLoopback,
  etapaNavegador,
  mensagemFinal,
  mensagensComIdDeSessao,
  mensagensComTrailer,
  opcoesDe,
  portasForaDoLoopback,
  temposDoPluginTest,
  testesAcimaDoTeto,
  veredictoDeTempo,
  versaoDoClaude,
  versaoDosTipos,
} from './preflight.mjs';

const compose = (hostIp) => ({
  services: { expediente: { ports: [{ host_ip: hostIp, published: '4848', target: 4848 }] } },
});

test('compose: reprova host_ip 0.0.0.0 e aceita 127.0.0.1', () => {
  assert.equal(portasForaDoLoopback(compose('0.0.0.0')).length, 1);
  assert.deepEqual(portasForaDoLoopback(compose('127.0.0.1')), []);
});

test('compose: porta sem host_ip reprova', () => {
  assert.equal(portasForaDoLoopback({ services: { a: { ports: [{ target: 1 }] } } }).length, 1);
});

test('lsof: só 127.0.0.1 passa; curinga e vazio reprovam', () => {
  const linha = (nome) => `node 1 u 20u IPv4 0x1 0t0 TCP ${nome} (LISTEN)`;
  assert.deepEqual(escutasForaDoLoopback(linha('127.0.0.1:4848')), []);
  assert.equal(escutasForaDoLoopback(linha('*:4848')).length, 1);
  assert.equal(escutasForaDoLoopback('').length, 1);
});

test('mensagens: trailer Co-Authored-By reprova', () => {
  assert.equal(mensagensComTrailer(['feat: x\n\nCo-Authored-By: Alguém <a@b.c>']).length, 1);
  assert.deepEqual(mensagensComTrailer(['feat: x\n\ncorpo sem trailer']), []);
});

test('mensagens: ID de sessão reprova, texto comum passa', () => {
  assert.equal(mensagensComIdDeSessao(['fix: cobre B-07']).length, 1);
  assert.equal(mensagensComIdDeSessao(['chore: x (G4.k)']).length, 1);
  assert.equal(mensagensComIdDeSessao(['fix: y (R1-01)']).length, 1);
  assert.equal(mensagensComIdDeSessao(['feat: z B-07']).length, 1);
  assert.deepEqual(mensagensComIdDeSessao(['chore: tira a checagem de versão externa']), []);
  assert.deepEqual(mensagensComIdDeSessao(['chore(fork): a partir do 0.4.0 (cb0c0bb)']), []);
});

test('caminhos: registro de sessão versionado reprova', () => {
  assert.deepEqual(caminhosDeRegistro(['server/a.ts', 'docs/x.md']), []);
  assert.equal(caminhosDeRegistro(['.docs-arquivo/a.md', '.playwright-mcp/b.png']).length, 2);
});

test('tipos: lê a versão do cabeçalho e a do claude --version', () => {
  assert.equal(versaoDosTipos('// Written by Claude Code 2.1.295.\n// Claude Code function hooks'), '2.1.295');
  assert.equal(versaoDosTipos('export {}'), null);
  assert.equal(versaoDoClaude('2.1.295 (Claude Code)\n'), '2.1.295');
});

const reg = (nome, duracao, limite = 5000) => ({ arquivo: '/r/a.test.ts', nome, duracao, limite });

test('tempo: só passa da metade do limite quem levou mais que ela', () => {
  const lentos = testesAcimaDoTeto([reg('rapido', 100), reg('na metade', 2500), reg('lento', 2501), reg('espera real', 9000, 20000), reg('espera longa', 10001, 20000)]);
  assert.deepEqual(lentos.map((t) => t.nome), ['lento', 'espera longa']);
});

test('tempo: lento também isolado reprova; lento só sob carga é aviso', () => {
  const lentos = [reg('cpu', 4000), reg('carga', 3000)];
  const { falhas, avisos } = veredictoDeTempo(lentos, new Map([['cpu', 3000], ['carga', 600]]));
  assert.equal(falhas.length, 1);
  assert.match(falhas[0], /^cpu /);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /^carga /);
});

test('tempo: sem medida isolada reprova', () => {
  assert.equal(veredictoDeTempo([reg('cpu', 4000)], new Map()).falhas.length, 1);
});

test('tempo do mod: lê arquivo e duração de cada teste e cobra acima de 1 s', () => {
  const saida = [
    'tests/a.test.ts:',
    '(pass) grupo > rapido [12.5ms]',
    '(pass) grupo > lento [1000.01ms]',
    '',
    'tests/b.test.ts:',
    '(pass) outro > no teto [1000ms]',
    '(fail) outro > quebrado [3ms]',
    ' 3 pass',
  ].join('\n');
  const registros = temposDoPluginTest(saida);
  assert.deepEqual(registros.map((r) => [r.arquivo, r.nome, r.duracao]), [
    ['tests/a.test.ts', 'grupo > rapido', 12.5],
    ['tests/a.test.ts', 'grupo > lento', 1000.01],
    ['tests/b.test.ts', 'outro > no teto', 1000],
  ]);
  assert.deepEqual(testesAcimaDoTeto(registros).map((r) => r.nome), ['grupo > lento']);
  const { falhas, avisos } = veredictoDeTempo(testesAcimaDoTeto(registros), new Map([['grupo > lento', 1200]]));
  assert.equal(falhas.length, 1);
  assert.equal(veredictoDeTempo(testesAcimaDoTeto(registros), new Map([['grupo > lento', 300]])).avisos.length, 1);
  assert.equal(avisos.length, 0);
});

test('navegador: sem a flag a etapa é pulada com aviso, e as flags valem cada uma por si', async () => {
  const r = await etapaNavegador(opcoesDe([]));
  assert.equal(r.pulado, true);
  assert.match(r.detalhe, /^sem --com-navegador: a fatia não fecha/);
  assert.deepEqual(opcoesDe(['--com-navegador']), { comContainer: false, comNavegador: true });
  assert.deepEqual(opcoesDe(['--com-container', '--com-navegador']), { comContainer: true, comNavegador: true });
});

test('mensagem final: só fecha a fatia com as duas flags', () => {
  assert.match(mensagemFinal(opcoesDe([])), /sem --com-container nem --com-navegador: a fatia ainda não fecha/);
  assert.match(mensagemFinal(opcoesDe(['--com-container'])), /sem --com-navegador: a fatia ainda não fecha/);
  assert.match(mensagemFinal(opcoesDe(['--com-navegador'])), /sem --com-container: a fatia ainda não fecha/);
  assert.equal(mensagemFinal(opcoesDe(['--com-container', '--com-navegador'])), 'pré-voo verde');
});
