import { describe, expect, it } from 'vitest';
import { idleVerdict, IDLE_TIMEOUT_MS, STALLED_GIVE_UP_MS } from './subagents';

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
