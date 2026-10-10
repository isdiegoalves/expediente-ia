// Medição da CPU do servidor nativo de teste (dist/server/index.js) sobre um HOME fictício com sessões
// vivas e transcripts sintéticos, com e sem aba conectada.
// Uso:
//   node scripts/medir-servidor.mjs --saida <pasta> [--cenarios parado-0,parado-1,vivo-0,vivo-1] [--duracao 120] [--aquecer 20] [--sessoes 18]
//
// Cenários: <carga>-<abas>.
//   parado  todas as sessões ociosas, nenhum transcript muda
//   vivo    três sessões gravam uma linha nova no transcript a cada 3 s (uma com subagentes)
//   abas    0 = nenhuma conexão em /api/stream; 1 = uma conexão aberta, lendo e descartando
// A CPU vem do tempo de CPU acumulado (ps) do servidor, em % de um núcleo. O servidor roda com HOME e porta
// fictícios (6700-6749), sem ler nada do computador de quem mede; as sessões "vivas" são processos `sleep`
// encerrados pelo pid no fim. A linha do tempo grava normalmente: o resultado inclui quanto ela cresceu.
import { execFileSync, spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : padrao;
};
const saida = opt('saida');
if (!saida) {
  console.error('uso: node scripts/medir-servidor.mjs --saida <pasta> [--cenarios parado-0,parado-1,vivo-0,vivo-1] [--duracao 120] [--aquecer 20] [--sessoes 18]');
  process.exit(2);
}
const duracao = Number(opt('duracao', '120'));
const aquecer = Number(opt('aquecer', '20'));
const nSessoes = Number(opt('sessoes', '18'));
const cenarios = opt('cenarios', 'parado-0,parado-1,vivo-0,vivo-1').split(',');
const INTERVALO_CPU_MS = 5_000;

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function portaLivre(porta) {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen(porta, '127.0.0.1', () => s.close(() => ok(true)));
  });
}

function cpuSegundos(pid) {
  const t = execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  return t.split(':').map(Number).reduce((acc, p) => acc * 60 + p, 0);
}

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

async function medirCenario(id, servidor, sessoes) {
  const [carga, abas] = id.split('-');
  let leitores = [];
  let bytesLidos = 0;
  const abrirAbas = async (n) => {
    for (let i = 0; i < n; i++) {
      const ctl = new AbortController();
      const r = await fetch(`http://127.0.0.1:${servidor.porta}/api/stream`, { signal: ctl.signal, headers: { Host: `127.0.0.1:${servidor.porta}` } });
      (async () => {
        try {
          for await (const parte of r.body) bytesLidos += parte.length;
        } catch {
          // encerrada pelo fim do cenário
        }
      })();
      leitores.push(ctl);
    }
  };
  await abrirAbas(Number(abas));

  let escritor = null;
  if (carga === 'vivo') {
    let n = 0;
    escritor = setInterval(() => {
      n++;
      sessoes.slice(0, 3).forEach((s, i) => {
        const at = Date.now();
        appendFileSync(s.transcript, resposta([ferramenta(`v${n}-${i}`, 'Edit', { file_path: `${s.cwd}/src/vivo-${n}.ts` })], s.sid, s.cwd, at) + '\n');
        if (i === 0) writeFileSync(s.registro, JSON.stringify({ pid: s.pid, sessionId: s.sid, cwd: s.cwd, startedAt: at - 3_600_000, kind: 'interactive', status: 'busy', updatedAt: at, statusUpdatedAt: at - 5_000 }));
      });
    }, 3_000);
  }

  await dormir(aquecer * 1000);
  const tamanhoAntes = tamanhoTimeline(servidor.dados);
  const amostras = [];
  let antes = { t: Date.now(), cpu: cpuSegundos(servidor.pid) };
  const carga0 = loadavg();
  const fim = Date.now() + duracao * 1000;
  while (Date.now() < fim) {
    await dormir(Math.min(INTERVALO_CPU_MS, fim - Date.now()));
    const agora = { t: Date.now(), cpu: cpuSegundos(servidor.pid) };
    amostras.push(Math.max(0, ((agora.cpu - antes.cpu) / ((agora.t - antes.t) / 1000)) * 100));
    antes = agora;
  }
  const carga1 = loadavg();
  const rssKb = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(servidor.pid)], { encoding: 'utf8' }).trim());
  const tamanhoDepois = tamanhoTimeline(servidor.dados);

  if (escritor) clearInterval(escritor);
  leitores.forEach((c) => c.abort());
  await dormir(500);
  const o = [...amostras].sort((a, b) => a - b);
  const q = (p) => o[Math.min(o.length - 1, Math.max(0, Math.ceil(p * o.length) - 1))];
  return {
    cenario: id,
    carga,
    abas: Number(abas),
    duracaoS: duracao,
    aquecimentoS: aquecer,
    sessoes: sessoes.length,
    cpuPct: { media: amostras.reduce((s, v) => s + v, 0) / amostras.length, p50: q(0.5), p95: q(0.95), max: o[o.length - 1] },
    rssMb: rssKb / 1024,
    linhaDoTempo: { bytesAntes: tamanhoAntes, bytesDepois: tamanhoDepois, cresceu: tamanhoDepois > tamanhoAntes },
    bytesRecebidosPelasAbas: bytesLidos,
    cargaDoSistema: { antes: carga0, depois: carga1, nucleos: cpus().length },
    amostras,
  };
}

function tamanhoTimeline(dados) {
  const pasta = resolve(dados, 'timeline');
  if (!existsSync(pasta)) return 0;
  return readdirSync(pasta).reduce((s, n) => s + statSync(resolve(pasta, n)).size, 0);
}

mkdirSync(saida, { recursive: true });
const casa = mkdtempSync(resolve(tmpdir(), 'medir-servidor-casa-'));
const sono = [];
let servidor = null;
try {
  for (let i = 0; i < nSessoes; i++) {
    const f = spawn('sleep', ['7200'], { stdio: 'ignore' });
    sono.push(f);
  }
  const pids = sono.map((f) => f.pid);
  const { sessoes } = montarCasa(casa, pids);

  let porta = 0;
  for (let p = 6700; p < 6750; p++) {
    if (await portaLivre(p)) {
      porta = p;
      break;
    }
  }
  if (!porta) throw new Error('sem porta livre em 6700-6749');
  const dados = resolve(casa, 'dados');
  mkdirSync(dados, { recursive: true });
  const filho = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: RAIZ,
    stdio: 'ignore',
    env: { PATH: process.env.PATH, HOME: casa, EXPEDIENTE_PORT: String(porta), EXPEDIENTE_DATA_DIR: dados, EXPEDIENTE_PONTE_DIR: resolve(casa, 'ponte') },
  });
  servidor = { porta, pid: filho.pid, filho, dados };
  let subiu = false;
  for (let i = 0; i < 100 && !subiu; i++) {
    try {
      subiu = (await fetch(`http://127.0.0.1:${porta}/`)).ok;
    } catch {
      await dormir(200);
    }
  }
  if (!subiu) throw new Error('servidor não subiu');
  const saude = await (await fetch(`http://127.0.0.1:${porta}/api/health`)).json().catch(() => null);
  console.error(`servidor pid ${servidor.pid} porta ${porta}; ${sessoes.length} sessões; saúde: ${JSON.stringify(saude)?.slice(0, 200)}`);

  const resultados = [];
  for (const id of cenarios) {
    console.error(`cenário ${id} (${aquecer}s + ${duracao}s)`);
    const r = await medirCenario(id, servidor, sessoes);
    resultados.push(r);
    writeFileSync(resolve(saida, `servidor-${id}.json`), JSON.stringify({ node: process.version, plataforma: `${process.platform}-${process.arch}`, ...r }, null, 1));
    console.error(`  CPU ${r.cpuPct.media.toFixed(1)}% (p95 ${r.cpuPct.p95.toFixed(1)}%), RSS ${r.rssMb.toFixed(0)} MB, linha do tempo ${r.linhaDoTempo.bytesAntes} -> ${r.linhaDoTempo.bytesDepois}`);
  }
  const f = (v) => v.toFixed(1);
  const resumo = [
    '| Cenário | Sessões | CPU média % | p95 % | máx % | RSS MB | Linha do tempo (bytes antes → depois) |',
    '|---|---|---|---|---|---|---|',
    ...resultados.map((r) => `| ${r.cenario} | ${r.sessoes} | ${f(r.cpuPct.media)} | ${f(r.cpuPct.p95)} | ${f(r.cpuPct.max)} | ${f(r.rssMb)} | ${r.linhaDoTempo.bytesAntes} → ${r.linhaDoTempo.bytesDepois} |`),
  ].join('\n');
  writeFileSync(resolve(saida, 'resumo-servidor.md'), resumo + '\n');
  console.log(resumo);
} finally {
  if (servidor) {
    try {
      process.kill(servidor.pid);
    } catch {}
  }
  for (const f of sono) {
    try {
      process.kill(f.pid);
    } catch {}
  }
  await dormir(500);
  rmSync(casa, { recursive: true, force: true });
}
process.exit(0);
