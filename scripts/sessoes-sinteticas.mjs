// Sessões fictícias do Claude Code para medir o servidor nativo: registro em <HOME>/.claude/sessions, transcripts
// sintéticos e processos `sleep` fazendo o papel dos processos vivos (o servidor confere o pid). Nada vem de conversas reais.
import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cwdDe = (i) => `/projetos/sintetico-${(i % 9) + 1}`;
const codificar = (cwd) => cwd.replace(/[^a-zA-Z0-9]/g, '-');

let seq = 0;
const iso = (at) => new Date(at).toISOString();
const linha = (tipo, extra, sessionId, cwd, at = Date.now()) => JSON.stringify({ type: tipo, uuid: `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`, timestamp: iso(at), sessionId, cwd, gitBranch: 'main', isSidechain: false, ...extra });
const prompt = (texto, sid, cwd, at) => linha('user', { message: { role: 'user', content: texto } }, sid, cwd, at);
const resposta = (blocos, sid, cwd, at) =>
  linha('assistant', { requestId: `req_${seq}`, message: { id: `msg_${seq}`, role: 'assistant', model: 'claude-teste-1', content: blocos, stop_reason: null, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 0 } } }, sid, cwd, at);
const ferramenta = (id, nome, input) => ({ type: 'tool_use', id, name: nome, input });

function montarCasa(casa, pids) {
  const dir = resolve(casa, '.claude');
  mkdirSync(resolve(dir, 'sessions'), { recursive: true });
  mkdirSync(resolve(dir, 'projects'), { recursive: true });
  const sessoes = [];
  const agora = Date.now();
  pids.forEach((pid, i) => {
    const sid = `sessao-sintetica-${i + 1}`;
    const cwd = cwdDe(i);
    const pasta = resolve(dir, 'projects', codificar(cwd));
    mkdirSync(pasta, { recursive: true });
    const transcript = resolve(pasta, `${sid}.jsonl`);
    const linhas = [];
    for (let k = 0; k < 60; k++) {
      const at = agora - (120 - k) * 60_000;
      linhas.push(prompt(`pedido sintético ${k}`, sid, cwd, at));
      linhas.push(resposta([ferramenta(`t${k}a`, 'Read', { file_path: `${cwd}/src/arquivo-${k}.ts` })], sid, cwd, at + 2_000));
    }
    writeFileSync(transcript, linhas.join('\n') + '\n');
    writeFileSync(resolve(dir, 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: sid, cwd, startedAt: agora - 3 * 3_600_000, kind: 'interactive', status: 'idle', updatedAt: agora, statusUpdatedAt: agora - 600_000 }));
    sessoes.push({ pid, sid, cwd, transcript, registro: resolve(dir, 'sessions', `${pid}.json`), pasta });
  });
  // algumas com subagentes já concluídos (parte do volume real)
  sessoes.slice(0, 4).forEach((s) => {
    const base = resolve(s.pasta, s.sid, 'subagents');
    mkdirSync(base, { recursive: true });
    for (let j = 0; j < 3; j++) {
      const id = `sub${j}`;
      writeFileSync(resolve(base, `agent-${id}.meta.json`), JSON.stringify({ agentType: 'Explore', description: `frente ${j}` }));
      const l = [];
      for (let k = 0; k < 20; k++) {
        l.push(linha('assistant', { isSidechain: true, agentId: id, requestId: `req_${seq}`, message: { id: `msg_${seq}`, role: 'assistant', model: 'claude-teste-1', content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } } }, s.sid, s.cwd, agora - 3_600_000 + k * 1_000));
      }
      writeFileSync(resolve(base, `agent-${id}.jsonl`), l.join('\n') + '\n');
    }
  });
  return { dir, sessoes };
}

/** Cria `n` sessões ociosas no HOME `casa`. `encerrar()` mata os `sleep` pelos pids que este processo criou. */
export function iniciarSessoes(casa, n) {
  const sono = Array.from({ length: n }, () => spawn('sleep', ['7200'], { stdio: 'ignore' }));
  const { sessoes } = montarCasa(casa, sono.map((f) => f.pid));
  return {
    sessoes,
    encerrar() {
      for (const f of sono) {
        try {
          process.kill(f.pid);
        } catch {}
      }
    },
  };
}

export function gravarRegistro(s, status, extra = {}) {
  const at = Date.now();
  writeFileSync(s.registro, JSON.stringify({ pid: s.pid, sessionId: s.sid, cwd: s.cwd, startedAt: at - 3_600_000, kind: 'interactive', status, updatedAt: at, statusUpdatedAt: at, ...extra }));
}

export function acrescentarAoTranscript(s, n) {
  appendFileSync(s.transcript, resposta([ferramenta(`v${n}-${s.pid}`, 'Edit', { file_path: `${s.cwd}/src/vivo-${n}.ts` })], s.sid, s.cwd, Date.now()) + '\n');
}
