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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, loadavg, tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acrescentarAoTranscript, gravarRegistro, iniciarSessoes } from './sessoes-sinteticas.mjs';

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
        acrescentarAoTranscript(s, n);
        if (i === 0) gravarRegistro(s, 'busy');
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
let servidor = null;
let fabrica = null;
try {
  fabrica = iniciarSessoes(casa, nSessoes);
  const { sessoes } = fabrica;

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
  fabrica?.encerrar();
  await dormir(500);
  rmSync(casa, { recursive: true, force: true });
}
process.exit(0);
