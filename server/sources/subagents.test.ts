import { describe, expect, it } from 'vitest';
import { idleVerdict, IDLE_TIMEOUT_MS, parseSubagentMeta, rodadaDoNome, STALLED_GIVE_UP_MS } from './subagents';

const check = (quiet: number, over: { ended?: boolean; pendingTool?: boolean } = {}) => ({
  now: quiet,
  lastWriteAt: 0,
  ended: over.ended ?? false,
  pendingTool: over.pendingTool ?? false,
});

describe('idleVerdict', () => {
  it('escrevendo há pouco: rodando', () => {
    expect(idleVerdict(check(IDLE_TIMEOUT_MS - 1))).toBe('running');
  });
  it('120 s sem escrita e sem fechamento: parado, com ou sem ferramenta pendente', () => {
    expect(idleVerdict(check(IDLE_TIMEOUT_MS))).toBe('stalled');
    expect(idleVerdict(check(IDLE_TIMEOUT_MS, { pendingTool: true }))).toBe('stalled');
  });
  it('terminou o turno e ficou 5 s quieto: concluiu', () => {
    expect(idleVerdict(check(4_999, { ended: true }))).toBe('running');
    expect(idleVerdict(check(5_000, { ended: true }))).toBe('concluded');
  });
  it('parado por tempo demais: desiste', () => {
    expect(idleVerdict(check(STALLED_GIVE_UP_MS - 1))).toBe('stalled');
    expect(idleVerdict(check(STALLED_GIVE_UP_MS))).toBe('concluded');
  });
});

describe('rodadaDoNome', () => {
  it('lê o prefixo rN- do nome', () => {
    expect(rodadaDoNome('r2-e1-avaliador-opus')).toBe(2);
    expect(rodadaDoNome('r12-x')).toBe(12);
    expect(rodadaDoNome('r07-x')).toBe(7);
  });
  it('sem prefixo, com três dígitos ou fora do início: sem rodada', () => {
    expect(rodadaDoNome('f2-b14-espera')).toBeUndefined();
    expect(rodadaDoNome('r123-x')).toBeUndefined();
    expect(rodadaDoNome('e1-r2-x')).toBeUndefined();
    expect(rodadaDoNome('r2x')).toBeUndefined();
    expect(rodadaDoNome(undefined)).toBeUndefined();
  });
});

describe('parseSubagentMeta: time, nome e parada pelo usuário', () => {
  it('lê teamName, name e stoppedByUser', () => {
    const m = parseSubagentMeta(JSON.stringify({ agentType: 'Explore', teamName: 'gauntlet', name: 'r1-a', stoppedByUser: true }));
    expect(m).toMatchObject({ teamName: 'gauntlet', name: 'r1-a', stoppedByUser: true });
  });
  it('ignora tipos errados e stoppedByUser falso', () => {
    const m = parseSubagentMeta(JSON.stringify({ teamName: 3, name: '  ', stoppedByUser: 'sim' }));
    expect(m).toEqual({});
    expect(parseSubagentMeta(JSON.stringify({ stoppedByUser: false }))).toEqual({});
  });
});
