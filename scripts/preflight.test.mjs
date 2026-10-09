import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caminhosDeRegistro,
  escutasForaDoLoopback,
  mensagensComIdDeSessao,
  mensagensComTrailer,
  portasForaDoLoopback,
  testesAcimaDaMetade,
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
  const lentos = testesAcimaDaMetade([reg('rapido', 100), reg('na metade', 2500), reg('lento', 2501), reg('espera real', 9000, 20000), reg('espera longa', 10001, 20000)]);
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
