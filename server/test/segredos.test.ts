import { describe, expect, it } from 'vitest';
import type { AgentStats, OfficeSnapshot } from '../../shared/types';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { sanitizeOutput } from '../model/saida';
import { createTranscriptState, parseLine } from '../sources/transcript';
import { L } from './fixtures';

setQuiet(true);

const GHP = `ghp_${'aB3dE6gH9jK2mN5pQ8sT1vW4yZ7cF0hJ3kL6'}`;
const BEARER = 'Bearer fictici0TokenValue1234567890';
const HOME = '/Users/ficticio/projetos';
const CWD = `${HOME}/loja-${GHP}`;
const SECRETS = [/\bgh[pousr]_[A-Za-z0-9]{16,}/, /\b(?:Bearer|Basic)\s+(?!\*\*\*)[A-Za-z0-9._~+/=-]{6,}/];

const stats: AgentStats = { toolCalls: 0, tokensIn: 0, tokensOut: 0, subagents: 0 };

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, out);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) strings(v, out);
  return out;
}

function office(): Office {
  const o = new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
    now: () => 1_000_000,
  });
  o.addMain({ id: 'acc:1', account: 'acc', sessionId: 's1', cwd: CWD, role: 'Agente principal', startedAt: 1, status: 'working' });
  o.applyTranscript('acc:1', {
    title: `Deploy com ${GHP} e ${BEARER}`,
    tasks: [{ id: 't1', title: `Chamar API com ${BEARER}`, status: 'in_progress', activeForm: `Chamando com ${GHP}` }],
    stats,
  });
  o.addSub({ id: 's1:sub', parentId: 'acc:1', sessionId: 's1', role: 'Explore', title: `Ler ${CWD} com ${BEARER}`, background: false, startedAt: 2 });
  o.addActivity('acc:1', { id: 'a1', at: 3, kind: 'run', icon: '⚡', text: 'Rodando curl', detail: `curl -H "Authorization: ${BEARER}" ${CWD}/x ${GHP}` }, true);
  return o;
}

function tudoQueASaidaMostra(o: Office): unknown[] {
  const c = o.commit();
  return [c.snapshot, c.feed, c.notices, o.recentFeed(50), o.detail('acc:1'), o.detail('s1:sub')];
}

describe('segredos mascarados na saída', () => {
  it('nenhum campo string do snapshot sobrevive com ghp_ ou Bearer', () => {
    const all = strings(tudoQueASaidaMostra(office()));
    expect(all.some((s) => s.includes('Deploy'))).toBe(true);
    for (const s of all) for (const re of SECRETS) expect(s, s).not.toMatch(re);
    expect(all.some((s) => s.includes('fictici0TokenValue'))).toBe(false);
  });

  it('o título da sessão e o da tarefa do subagente chegam mascarados no agente', () => {
    const snap = office().commit().snapshot as OfficeSnapshot;
    const main = snap.agents.find((x) => x.id === 'acc:1');
    const sub = snap.agents.find((x) => x.id === 's1:sub');
    expect(main?.title).toContain('Deploy com');
    expect(main?.title).not.toContain('ghp_');
    expect(main?.title).not.toContain('fictici0TokenValue');
    expect(sub?.title).not.toContain('fictici0TokenValue');
  });
  it('cwd chega só com o nome da pasta', () => {
    const snap = office().commit().snapshot as OfficeSnapshot;
    for (const s of strings(tudoQueASaidaMostra(office()))) expect(s, s).not.toContain(HOME);
    const room = snap.rooms[0];
    expect(room.path).toBe('loja-gh*_***');
    expect(snap.agents.every((a) => a.roomId === room.id)).toBe(true);
  });

  it('a função única mascara e encurta caminho em qualquer estrutura', () => {
    const out = sanitizeOutput({ a: [`x ${GHP}`, { b: `${HOME}/p/src/a.ts` }], n: 1 }, new Map([[`${HOME}/p`, 'p']]));
    expect(out).toEqual({ a: ['x gh*_***', { b: 'p/src/a.ts' }], n: 1 });
  });

  it('linha crua de transcript: cwd com segredo e corte no meio do caminho não deixam /Users/ no snapshot', () => {
    const cru = (blocks: Array<Record<string, unknown>>) => JSON.stringify({ ...JSON.parse(L.assistant(blocks, { at: 5 })), cwd: CWD });
    const comando = `${'a'.repeat(250)} && cat ${CWD}/src/a.ts ${HOME}/outra/b.ts`;
    const state = createTranscriptState();
    const o = office();
    let n = 0;
    for (const raw of [cru([L.tool('t1', 'Bash', { command: comando })]), cru([L.tool('t2', 'Read', { file_path: `${CWD}/src/a.ts` })])]) {
      for (const a of parseLine(state, raw, { idPrefix: 'acc:1', now: 6 }).activities) o.addActivity('acc:1', { ...a.activity, id: `crua-${++n}` }, true);
    }
    const all = strings(tudoQueASaidaMostra(o));
    expect(all.some((x) => x.includes('cat loja-gh*_***'))).toBe(true);
    for (const x of all) {
      expect(x, x).not.toMatch(/\/Users\//);
      expect(x, x).not.toContain(HOME);
    }
  });

  it('pasta do usuário vira ~ e prefixo cortado de caminho conhecido some', () => {
    const projetos = new Map([[`${HOME}/loja`, 'loja']]);
    expect(sanitizeOutput('cat /Users/ficticio/outro/x.ts', projetos)).toBe('cat ~/outro/x.ts');
    expect(sanitizeOutput('cat /home/ficticio/outro/x.ts', projetos)).toBe('cat ~/outro/x.ts');
    expect(sanitizeOutput(`cat ${HOME}/lo…`, projetos)).toBe('cat …');
    expect(sanitizeOutput('cat /home/fict…', projetos)).toBe('cat ~…');
    expect(sanitizeOutput('cat /Users/ficticio/outro/x.ts', projetos, { trocarCaminhos: false })).toBe('cat /Users/ficticio/outro/x.ts');
  });
});
