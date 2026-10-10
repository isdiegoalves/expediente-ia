// Medição de escala do escritório (?mock=1) em um Chromium próprio, com servidor nativo de teste.
// Uso:
//   node scripts/medir-escala.mjs --saida <pasta> [--cenarios a,b,c,d,e] [--duracao 300] [--aquecer 30] [--dpr 2] [--gpu "flags"] [--maquete]
//
// Cenários (todos com o simulador no navegador):
//   a  10 salas x 30 subagentes, janela visível
//   b  o mesmo com a aba oculta (emulada na página: document.hidden, rAF parado, temporizadores a 1 Hz)
//   c  o mesmo com a cena parada (o simulador deixa de gerar eventos)
//   d  mock atual com 10 sessões      e  mock atual com 40 sessões
//   i  10 sessões ociosas, nada acontece, medido depois de 5 min de aquecimento; ao fim, um movimento do mouse
//      mede em quanto tempo e a quantos quadros por segundo o desenho volta
//   j  servidor real com 18 sessões fictícias ociosas e a página sem ?mock: depois da janela calma, uma sessão passa a
//      esperar permissão; mede o caminho todo (registro, servidor, SSE, página) até os quadros cheios
//
// O tempo de trabalho do quadro é a soma da duração dos callbacks de requestAnimationFrame de um mesmo
// quadro (performance.now em volta de cada callback), não o intervalo entre quadros. A CPU vem do tempo de
// CPU acumulado (ps) do servidor e da árvore de processos do Chromium, em % de um núcleo.
// Dá para pedir uma lista: --cenarios a,d,e. Usa o chrome-headless-shell do Playwright por CDP direto
// (o Chrome completo não carrega http://127.0.0.1 neste ambiente, e o headless nunca oculta uma aba de verdade).
import { chromium } from 'playwright-core';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cpus, loadavg, tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gravarRegistro, iniciarSessoes } from './sessoes-sinteticas.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (nome, padrao) => {
  const i = args.indexOf(`--${nome}`);
  return i >= 0 ? args[i + 1] : padrao;
};
const saida = opt('saida');
if (!saida) {
  console.error('uso: node scripts/medir-escala.mjs --saida <pasta> [--cenarios a,b,c,d,e] [--duracao 300] [--aquecer 30] [--dpr 2]');
  process.exit(2);
}
const duracao = Number(opt('duracao', '300'));
const aquecer = Number(opt('aquecer', '30'));
const dpr = Number(opt('dpr', '2'));
const maquete = args.includes('--maquete');
const gpuArgs = opt('gpu', '') ? opt('gpu').split(' ') : [];
const largura = 1600;
const altura = 900;
const INTERVALO_CPU_MS = 5_000;
const CENARIOS = {
  a: { titulo: '10 salas x 30 subagentes, visível', query: 'sessions=10&projects=10&subs=30' },
  b: { titulo: '10 salas x 30 subagentes, aba oculta', query: 'sessions=10&projects=10&subs=30', oculta: true },
  c: { titulo: '10 salas x 30 subagentes, cena parada', query: 'sessions=10&projects=10&subs=30', parada: true },
  d: { titulo: 'mock atual, 10 sessões', query: 'sessions=10' },
  e: { titulo: 'mock atual, 40 sessões', query: 'sessions=40' },
  i: { titulo: '10 sessões ociosas, nada acontece (após 5 min)', query: 'sessions=10&quieto=1', aquecer: 300, despertar: true },
  j: { titulo: 'servidor real, 18 sessões ociosas e um alerta novo', real: true, aquecer: 90, duracao: 20, alerta: true },
};
const escolhidos = opt('cenarios', 'a,b,c,d,e').split(',').map((s) => s.trim());
for (const c of escolhidos) if (!CENARIOS[c]) throw new Error(`cenário desconhecido: ${c}`);

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function portaLivre(porta) {
  return new Promise((ok) => {
    const s = createServer();
    s.once('error', () => ok(false));
    s.listen(porta, '127.0.0.1', () => s.close(() => ok(true)));
  });
}

function segundosDeCpu(texto) {
  const partes = texto.trim().split(':').map(Number);
  return partes.reduce((acc, p) => acc * 60 + p, 0);
}

function tabelaDeProcessos() {
  const bruto = execFileSync('ps', ['-axo', 'pid=,ppid=,time=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const mapa = new Map();
  for (const linha of bruto.split('\n')) {
    const m = linha.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    const tipo = m[5].match(/--type=([\w-]+)/)?.[1] ?? 'browser';
    mapa.set(Number(m[1]), { ppid: Number(m[2]), cpu: segundosDeCpu(m[3]), rssKb: Number(m[4]), tipo, cmd: m[5] });
  }
  return mapa;
}

function arvore(mapa, raiz) {
  const pids = new Set([raiz]);
  let mudou = true;
  while (mudou) {
    mudou = false;
    for (const [pid, p] of mapa) if (!pids.has(pid) && pids.has(p.ppid)) (pids.add(pid), (mudou = true));
  }
  return [...pids].filter((pid) => mapa.has(pid));
}

function amostraDeCpu(pidServidor, pidNavegador) {
  const mapa = tabelaDeProcessos();
  const porPid = new Map();
  const soma = { servidor: 0, navegador_principal: 0, pagina: 0, gpu: 0, outros: 0 };
  const rss = { servidor: 0, navegador: 0 };
  const srv = mapa.get(pidServidor);
  if (srv) {
    porPid.set(pidServidor, ['servidor', srv.cpu]);
    rss.servidor = srv.rssKb;
  }
  for (const pid of arvore(mapa, pidNavegador)) {
    const p = mapa.get(pid);
    const grupo = p.tipo === 'renderer' ? 'pagina' : p.tipo === 'gpu-process' ? 'gpu' : p.tipo === 'browser' ? 'navegador_principal' : 'outros';
    porPid.set(pid, [grupo, p.cpu]);
    rss.navegador += p.rssKb;
  }
  return { t: Date.now(), porPid, soma, rss };
}

function deltaDeCpu(a, b) {
  const dt = (b.t - a.t) / 1000;
  const grupos = { servidor: 0, navegador_principal: 0, pagina: 0, gpu: 0, outros: 0 };
  for (const [pid, [grupo, cpu]] of b.porPid) {
    const antes = a.porPid.get(pid);
    if (antes) grupos[grupo] += (cpu - antes[1]) / dt;
  }
  const out = { t: b.t };
  for (const g of Object.keys(grupos)) out[g] = Math.max(0, grupos[g] * 100);
  out.navegador_total = out.navegador_principal + out.pagina + out.gpu + out.outros;
  out.rssServidorMb = b.rss.servidor / 1024;
  out.rssNavegadorMb = b.rss.navegador / 1024;
  return out;
}

function estatistica(valores) {
  if (!valores.length) return { n: 0 };
  const o = [...valores].sort((x, y) => x - y);
  const q = (p) => o[Math.min(o.length - 1, Math.max(0, Math.ceil(p * o.length) - 1))];
  return { n: o.length, media: valores.reduce((s, v) => s + v, 0) / o.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: o[o.length - 1] };
}

const SCRIPT_DE_MEDIDA = `(() => {
  const m = { quadros: [], marcas: [], desenhos: [], snapshots: [], ticks: [], congelado: false, oculto: false, cursor: -1, acc: 0 };
  m.inicio = () => { m.quadros.length = 0; m.marcas.length = 0; m.desenhos.length = 0; m.ticks.length = 0; m.cursor = -1; m.acc = 0; };
  const adiados = [];
  const preencher = CanvasRenderingContext2D.prototype.fillRect;
  CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
    if (x === 0 && y === 0 && w === this.canvas.width && h === this.canvas.height && this.canvas.isConnected) m.desenhos.push(performance.now());
    return preencher.call(this, x, y, w, h);
  };
  const adicionar = EventSource.prototype.addEventListener;
  EventSource.prototype.addEventListener = function (tipo, fn, ...r) {
    if (tipo !== 'snapshot') return adicionar.call(this, tipo, fn, ...r);
    return adicionar.call(this, tipo, (e) => {
      m.snapshots.push(performance.timeOrigin + performance.now());
      return fn.call(this, e);
    }, ...r);
  };
  const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    if (m.oculto) {
      adiados.push(cb);
      return -adiados.length;
    }
    return raf((ts) => {
      const a = performance.now();
      try {
        cb(ts);
      } finally {
        const d = performance.now() - a;
        if (ts !== m.cursor) {
          if (m.cursor >= 0) m.quadros.push(m.acc);
          m.marcas.push(ts);
          m.cursor = ts;
          m.acc = 0;
        }
        m.acc += d;
      }
    });
  };
  const st = window.setTimeout.bind(window);
  const ct = window.clearTimeout.bind(window);
  window.setTimeout = (fn, ms, ...r) => st(fn, m.oculto ? Math.max(ms || 0, 1000) : ms, ...r);
  const intervalos = new Map();
  let proximo = 1e6;
  window.setInterval = (fn, ms, ...r) => {
    const id = ++proximo;
    const passo = () => {
      intervalos.set(id, st(passo, m.oculto ? Math.max(ms || 0, 1000) : ms));
      if (ms === 250 && typeof fn === 'function') {
        if (m.congelado) return;
        const t = performance.now();
        try {
          fn(...r);
        } finally {
          m.ticks.push(performance.now() - t);
        }
      } else if (typeof fn === 'function') fn(...r);
    };
    intervalos.set(id, st(passo, ms));
    return id;
  };
  window.clearInterval = (id) => { ct(intervalos.get(id)); intervalos.delete(id); };
  let oculto = false;
  Object.defineProperty(document, 'hidden', { get: () => oculto, configurable: true });
  Object.defineProperty(document, 'visibilityState', { get: () => (oculto ? 'hidden' : 'visible'), configurable: true });
  m.ocultar = (v) => {
    oculto = v;
    m.oculto = v;
    document.dispatchEvent(new Event('visibilitychange'));
    if (!v) adiados.splice(0).forEach((cb) => window.requestAnimationFrame(cb));
  };
  window.__medida = m;
})();`;

class Cdp {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pend = new Map();
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const p = m.id && this.pend.get(m.id);
      if (p) {
        this.pend.delete(m.id);
        m.error ? p.reject(new Error(`${m.error.message}`)) : p.resolve(m.result);
      }
    };
  }
  static async conectar(url) {
    const ws = new WebSocket(url);
    await new Promise((ok, erro) => ((ws.onopen = ok), (ws.onerror = erro)));
    return new Cdp(ws);
  }
  enviar(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pend.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
  async avaliar(sessionId, expressao) {
    const r = await this.enviar('Runtime.evaluate', { expression: expressao, returnByValue: true, awaitPromise: true }, sessionId);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
    return r.result.value;
  }
}

async function abrirServidor(casa, real = false) {
  let porta = 0;
  const [de, ate] = real ? [6700, 6750] : [6400, 6500];
  for (let p = de; p < ate; p++) {
    if (await portaLivre(p)) {
      porta = p;
      break;
    }
  }
  if (!porta) throw new Error(`sem porta livre em ${de}-${ate - 1}`);
  mkdirSync(resolve(casa, 'dados'), { recursive: true });
  const filho = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: RAIZ,
    stdio: 'ignore',
    env: {
      PATH: process.env.PATH,
      HOME: casa,
      EXPEDIENTE_PORT: String(porta),
      EXPEDIENTE_DATA_DIR: resolve(casa, 'dados'),
      EXPEDIENTE_PONTE_DIR: resolve(casa, 'ponte'),
      ...(real ? {} : { EXPEDIENTE_TERMINAL: '0', EXPEDIENTE_TIMELINE: '0' }),
    },
  });
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/`);
      if (r.ok) return { porta, pid: filho.pid, filho };
    } catch {}
    await dormir(200);
  }
  filho.kill();
  throw new Error('servidor não subiu');
}

function executavelDoNavegador() {
  const completo = chromium.executablePath();
  const shell = resolve(completo.slice(0, completo.indexOf('chromium-')), 'chromium_headless_shell-' + completo.match(/chromium-(\d+)/)[1], 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
  if (!existsSync(shell)) throw new Error('chrome-headless-shell não encontrado: ' + shell);
  return shell;
}

async function abrirNavegador(perfil) {
  const porta = 9400 + Math.floor(Math.random() * 90);
  const filho = spawn(
    executavelDoNavegador(),
    [`--remote-debugging-port=${porta}`, `--user-data-dir=${perfil}`, `--window-size=${largura},${altura}`, '--no-first-run', '--disable-breakpad', ...gpuArgs, 'about:blank'],
    { stdio: 'ignore', env: { PATH: process.env.PATH, HOME: perfil } },
  );
  let versao;
  for (let i = 0; i < 100 && !versao; i++) {
    try {
      versao = await (await fetch(`http://127.0.0.1:${porta}/json/version`)).json();
    } catch {
      await dormir(200);
    }
  }
  if (!versao) throw new Error('Chromium não respondeu');
  const cdp = await Cdp.conectar(versao.webSocketDebuggerUrl);
  const mapa = tabelaDeProcessos();
  const pid = [...mapa].find(([, p]) => p.tipo === 'browser' && p.cmd.includes(`--user-data-dir=${perfil}`))?.[0] ?? filho.pid;
  return { cdp, pid, versao: versao.Browser, filho };
}

async function abrirAba(cdp, url) {
  const { targetId } = await cdp.enviar('Target.createTarget', { url, newWindow: false });
  const { sessionId } = await cdp.enviar('Target.attachToTarget', { targetId, flatten: true });
  return { targetId, sessionId };
}

async function medir(id, servidorMock, navegador) {
  const c = CENARIOS[id];
  const casaReal = c.real ? mkdtempSync(resolve(tmpdir(), 'medir-escala-real-')) : null;
  const fabrica = casaReal ? iniciarSessoes(casaReal, 18) : null;
  const servidor = casaReal ? await abrirServidor(casaReal, true) : servidorMock;
  try {
    return await medirCenario(id, c, servidor, navegador, fabrica);
  } finally {
    if (casaReal) {
      try {
        process.kill(servidor.pid);
      } catch {}
      fabrica.encerrar();
      rmSync(casaReal, { recursive: true, force: true });
    }
  }
}

async function medirCenario(id, c, servidor, navegador, fabrica) {
  const duracaoDoCenario = opt('duracao') !== undefined ? duracao : (c.duracao ?? duracao);
  const { cdp } = navegador;
  const aba = await abrirAba(cdp, 'about:blank');
  await cdp.enviar('Page.enable', {}, aba.sessionId);
  await cdp.enviar('Emulation.setDeviceMetricsOverride', { width: largura, height: altura, deviceScaleFactor: dpr, mobile: false }, aba.sessionId);
  await cdp.enviar('Page.addScriptToEvaluateOnNewDocument', { source: SCRIPT_DE_MEDIDA }, aba.sessionId);
  if (maquete) {
    await cdp.enviar('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('expediente:prefs', JSON.stringify({ maquete: true }))` }, aba.sessionId);
  }
  const url = c.real ? `http://127.0.0.1:${servidor.porta}/` : `http://127.0.0.1:${servidor.porta}/?mock=1&${c.query}`;
  await cdp.enviar('Page.navigate', { url }, aba.sessionId);
  await dormir(3_000);
  const ambiente = await cdp.avaliar(aba.sessionId, `({ ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, hidden: document.hidden, salas: document.querySelectorAll('canvas').length })`);

  if (c.oculta) await cdp.avaliar(aba.sessionId, 'window.__medida.ocultar(true)');
  const aquecimento = opt('aquecer') !== undefined ? aquecer : (c.aquecer ?? aquecer);
  await dormir(aquecimento * 1000);
  if (c.parada) await cdp.avaliar(aba.sessionId, 'window.__medida.congelado = true');
  await cdp.avaliar(aba.sessionId, 'window.__medida.inicio()');
  const ocultaNoInicio = await cdp.avaliar(aba.sessionId, 'document.hidden');

  const carga0 = loadavg();
  const cpu = [];
  let anterior = amostraDeCpu(servidor.pid, navegador.pid);
  const fim = Date.now() + duracaoDoCenario * 1000;
  while (Date.now() < fim) {
    await dormir(Math.min(INTERVALO_CPU_MS, fim - Date.now()));
    const atual = amostraDeCpu(servidor.pid, navegador.pid);
    cpu.push(deltaDeCpu(anterior, atual));
    anterior = atual;
  }
  const carga1 = loadavg();
  const bruto = await cdp.avaliar(aba.sessionId, 'JSON.stringify({ quadros: window.__medida.quadros, marcas: window.__medida.marcas, desenhos: window.__medida.desenhos, ticks: window.__medida.ticks, hidden: document.hidden })');
  const { quadros, marcas, desenhos, ticks, hidden: ocultaNoFim } = JSON.parse(bruto);
  const intervalos = marcas.slice(1).map((t, i) => t - marcas[i]);

  let despertar = null;
  if (c.despertar) {
    await cdp.avaliar(aba.sessionId, 'window.__medida.inicio(), window.__medida.disparo = performance.now()');
    await cdp.enviar('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 300, y: 300 }, aba.sessionId);
    await dormir(2_000);
    const d = JSON.parse(await cdp.avaliar(aba.sessionId, 'JSON.stringify({ disparo: window.__medida.disparo, marcas: window.__medida.marcas })'));
    const apos = d.marcas.filter((t) => t >= d.disparo);
    const emUmSegundo = apos.filter((t) => t <= d.disparo + 1000);
    despertar = { primeiroQuadroMs: apos.length ? apos[0] - d.disparo : null, quadrosEmUmSegundo: emUmSegundo.length, intervaloMedioMs: emUmSegundo.length > 1 ? (emUmSegundo[emUmSegundo.length - 1] - emUmSegundo[0]) / (emUmSegundo.length - 1) : null };
  }

  let alerta = null;
  if (c.alerta) {
    await cdp.avaliar(aba.sessionId, 'window.__medida.inicio()');
    const escritoEm = Date.now();
    gravarRegistro(fabrica.sessoes[0], 'waiting', { waitingFor: 'approve Bash' });
    await dormir(4_000);
    const d = JSON.parse(await cdp.avaliar(aba.sessionId, 'JSON.stringify({ origem: performance.timeOrigin, marcas: window.__medida.marcas, snapshots: window.__medida.snapshots })'));
    const quadrosEm = d.marcas.map((t) => d.origem + t);
    const snapshotEm = d.snapshots.find((t) => t >= escritoEm);
    const apos = snapshotEm === undefined ? [] : quadrosEm.filter((t) => t >= snapshotEm);
    const cheios = apos.findIndex((t, i) => i + 5 < apos.length && apos.slice(i, i + 6).every((v, k, a) => k === 0 || v - a[k - 1] < 35));
    alerta = {
      snapshotChegouAposAEscritaMs: snapshotEm === undefined ? null : snapshotEm - escritoEm,
      primeiroQuadroAposOSnapshotMs: apos.length ? apos[0] - snapshotEm : null,
      quadrosCheiosAposOSnapshotMs: cheios >= 0 ? apos[cheios] - snapshotEm : null,
      quadrosCheiosAposAEscritaMs: cheios >= 0 ? apos[cheios] - escritoEm : null,
      quadrosEmUmSegundoAposOSnapshot: snapshotEm === undefined ? 0 : apos.filter((t) => t <= snapshotEm + 1000).length,
    };
  }

  if (!c.oculta) {
    const { data } = await cdp.enviar('Page.captureScreenshot', { format: 'jpeg', quality: 60 }, aba.sessionId);
    writeFileSync(resolve(saida, `cenario-${id}-dpr${dpr}.jpg`), Buffer.from(data, 'base64'));
  }
  await cdp.enviar('Target.closeTarget', { targetId: aba.targetId });

  const col = (k) => estatistica(cpu.map((s) => s[k]));
  const resultado = {
    cenario: id,
    titulo: c.titulo,
    url,
    duracaoS: duracaoDoCenario,
    aquecimentoS: aquecimento,
    despertar,
    alerta,
    ambiente: { ...ambiente, ocultaNoInicio, ocultaNoFim },
    quadros: { total: quadros.length, fpsEfetivo: quadros.length / duracaoDoCenario, trabalhoMs: estatistica(quadros), intervaloMs: estatistica(intervalos), menoresQue99Ms: intervalos.filter((v) => v < 99).length, desenhosDoMundo: desenhos.length, desenhosDoMundoPorSegundo: desenhos.length / duracaoDoCenario, intervaloEntreDesenhosMs: estatistica(desenhos.slice(1).map((t, i) => t - desenhos[i])), desenhosMs: desenhos.slice(0, 400).map((t) => Math.round(t * 10) / 10) },
    tickMock250ms: { total: ticks.length, ms: estatistica(ticks) },
    cpuPct: { servidor: col('servidor'), navegador_total: col('navegador_total'), pagina: col('pagina'), gpu: col('gpu'), navegador_principal: col('navegador_principal'), outros: col('outros') },
    rssMb: { servidor: col('rssServidorMb'), navegador: col('rssNavegadorMb') },
    cargaDoSistema: { antes: carga0, depois: carga1, nucleos: cpus().length },
    amostrasDeCpu: cpu,
    trabalhoPorQuadroMs: quadros.map((v) => Math.round(v * 1000) / 1000),
  };
  return resultado;
}

function linha(r) {
  const f = (v, d = 2) => (v === undefined || Number.isNaN(v) ? '-' : v.toFixed(d));
  const q = r.quadros.trabalhoMs;
  return `| ${r.cenario} | ${r.titulo} | ${r.quadros.total ? `${f(q.media)} / ${f(q.p95)} / ${f(q.max, 1)}` : 'sem quadros'} | ${f(r.quadros.fpsEfetivo, 1)} | ${f(r.tickMock250ms.ms.media)} / ${f(r.tickMock250ms.ms.p95)} | ${f(r.cpuPct.servidor.media, 1)} | ${f(r.cpuPct.pagina.media, 0)} | ${f(r.cpuPct.gpu.media, 0)} | ${f(r.cpuPct.navegador_total.media, 0)} |`;
}

mkdirSync(saida, { recursive: true });
const casa = mkdtempSync(resolve(tmpdir(), 'medir-escala-casa-'));
const perfil = mkdtempSync(resolve(tmpdir(), 'medir-escala-chr-'));
const servidor = await abrirServidor(casa);
const navegador = await abrirNavegador(perfil).catch((erro) => {
  try {
    process.kill(servidor.pid);
  } catch {}
  rmSync(casa, { recursive: true, force: true });
  rmSync(perfil, { recursive: true, force: true });
  throw erro;
});
const info = await navegador.cdp.enviar('SystemInfo.getInfo');
const gpu = { versaoDoNavegador: navegador.versao, modo: 'chrome-headless-shell (headless)', dispositivos: info.gpu.devices.map((d) => `${d.vendorString} ${d.deviceString}`.trim()), recursos: info.gpu.featureStatus ?? null };
const ambienteGeral = { node: process.version, plataforma: `${process.platform}-${process.arch}`, nucleos: cpus().length, dpr, janela: `${largura}x${altura}`, portaDoServidor: servidor.porta, gpu, inicio: new Date().toISOString() };
console.error(`servidor pid ${servidor.pid} porta ${servidor.porta}; navegador pid ${navegador.pid}; ${JSON.stringify(gpu.dispositivos)}`);

const resultados = [];
try {
  for (const id of escolhidos) {
    console.error(`cenário ${id}: ${CENARIOS[id].titulo} (${CENARIOS[id].aquecer ?? aquecer}s de aquecimento + ${CENARIOS[id].duracao ?? duracao}s)`);
    const r = await medir(id, servidor, navegador);
    resultados.push(r);
    writeFileSync(resolve(saida, `cenario-${id}-dpr${dpr}.json`), JSON.stringify({ ambienteGeral, ...r }, null, 1));
    console.error(linha(r));
  }
} finally {
  try {
    await Promise.race([navegador.cdp.enviar('Browser.close'), dormir(2_000)]);
  } catch {}
  await dormir(1_000);
  for (const pid of [navegador.pid, servidor.pid]) {
    try {
      process.kill(pid);
    } catch {}
  }
  rmSync(casa, { recursive: true, force: true });
  rmSync(perfil, { recursive: true, force: true });
}

const resumo = [
  `Ambiente: ${JSON.stringify({ ...ambienteGeral, gpu: { ...gpu, recursos: undefined } })}`,
  '',
  '| Cen. | Cenário | Trabalho do quadro ms (média / p95 / máx) | Quadros/s | Tick do mock 250 ms (média / p95) | CPU servidor % | CPU página % | CPU GPU % | CPU navegador total % |',
  '|---|---|---|---|---|---|---|---|---|',
  ...resultados.map(linha),
].join('\n');
writeFileSync(resolve(saida, `resumo-dpr${dpr}.md`), resumo + '\n');
console.log(resumo);
process.exit(0);
