#!/usr/bin/env node
// Prova de que o servidor não abre conexões de saída: amostra as conexões TCP por um tempo e grava os
// destinos fora do loopback (a lista tem de ficar vazia).
//
//   node scripts/prova-rede.mjs [--duracao 3600] [--intervalo 10] [--container expediente | --pid <pid>] [--saida <arquivo> [--sobrescrever]]
//
// Sem --saida o relatório vai só para a saída padrão. Arquivo que já existe só é trocado com --sobrescrever.
// Container: lê /proc/net/tcp e /proc/net/tcp6 por `docker exec` (só leitura). Nativo: `lsof -nP -i -a -p <pid>`.
// Sai com 1 se houver destino externo e com 2 se alguma amostra falhar (sem amostra não há prova).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function expandirV6(texto) {
  let t = texto.replace(/^\[|\]$/g, '').split('%')[0];
  const v4 = t.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const o = v4[2].split('.').map(Number);
    t = v4[1] + ((o[0] << 8) | o[1]).toString(16) + ':' + ((o[2] << 8) | o[3]).toString(16);
  }
  const [cabeca, cauda, resto] = t.split('::');
  if (resto !== undefined) return null;
  const a = cabeca ? cabeca.split(':') : [];
  const b = cauda === undefined ? [] : cauda ? cauda.split(':') : [];
  if (cauda === undefined) return a.length === 8 ? a.map((g) => parseInt(g, 16)) : null;
  const falta = 8 - a.length - b.length;
  if (falta < 1) return null;
  return [...a, ...Array(falta).fill('0'), ...b].map((g) => parseInt(g, 16));
}

/** Loopback: 127.0.0.0/8, ::1 e ::ffff:127.x. Endereço que não dá para ler não é loopback. */
export function isLoopback(ip) {
  const v4 = /^(\d+)\.\d+\.\d+\.\d+$/.exec(ip);
  if (v4) return Number(v4[1]) === 127;
  const g = ip.includes(':') ? expandirV6(ip) : null;
  if (!g || g.some((x) => Number.isNaN(x))) return false;
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;
  return g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff && g[6] >> 8 === 127;
}

function hexParaIp(hex) {
  if (hex.length === 8) {
    return hex
      .match(/../g)
      .reverse()
      .map((x) => parseInt(x, 16))
      .join('.');
  }
  if (hex.length === 32) {
    const grupos = [];
    for (let i = 0; i < 32; i += 8) {
      const b = hex.slice(i, i + 8).match(/../g).reverse();
      grupos.push(b[0] + b[1], b[2] + b[3]);
    }
    return grupos.map((g) => parseInt(g, 16).toString(16)).join(':');
  }
  return null;
}

const SEM_PAR = (ip) => /^0(\.0){3}$/.test(ip) || /^(0:){7}0$/.test(ip);

/** Conexões de /proc/net/tcp ou tcp6: [{ local, localPort, remoto, remotoPort, escuta }]. */
export function parseProcNetTcp(texto) {
  const saida = [];
  for (const linha of texto.split('\n').slice(1)) {
    const c = linha.trim().split(/\s+/);
    if (c.length < 4) continue;
    const [lh, lp] = c[1].split(':');
    const [rh, rp] = c[2].split(':');
    const local = hexParaIp(lh ?? '');
    const remoto = hexParaIp(rh ?? '');
    if (!local || !remoto || !lp || !rp) continue;
    saida.push({ local, localPort: parseInt(lp, 16), remoto, remotoPort: parseInt(rp, 16), escuta: c[3] === '0A' });
  }
  return saida;
}

const HOST = String.raw`(\*|[\d.]+|\[[^\]]+\])`;
const SOCKET = new RegExp(String.raw`^${HOST}:(\d+|\*)(?:->${HOST}:(\d+|\*))?$`);

/** Conexões da saída de `lsof -nP -i`: mesma forma de parseProcNetTcp. */
export function parseLsof(texto) {
  const saida = [];
  for (const linha of texto.split('\n')) {
    const m = /\s(TCP|UDP)\s+(\S+)(?:\s+\((\w+)\))?\s*$/.exec(linha);
    if (!m) continue;
    const s = SOCKET.exec(m[2]);
    if (!s) continue;
    const limpa = (h) => h.replace(/^\[|\]$/g, '');
    saida.push({
      local: limpa(s[1]),
      localPort: Number(s[2]) || 0,
      remoto: s[3] ? limpa(s[3]) : '',
      remotoPort: s[4] ? Number(s[4]) : 0,
      escuta: m[3] === 'LISTEN',
    });
  }
  return saida;
}

/** Destinos "ip:porta" fora do loopback. Aceitar conexão numa porta em escuta é entrada, não saída. */
export function destinosExternos(conexoes) {
  const portasEscuta = new Set(conexoes.filter((c) => c.escuta).map((c) => c.localPort));
  const fora = new Set();
  for (const c of conexoes) {
    if (c.escuta || !c.remoto || SEM_PAR(c.remoto) || isLoopback(c.remoto)) continue;
    if (portasEscuta.has(c.localPort)) continue;
    fora.add(c.remoto.includes(':') ? `[${c.remoto}]:${c.remotoPort}` : `${c.remoto}:${c.remotoPort}`);
  }
  return [...fora].sort();
}

export function parseArgs(argv) {
  const o = { duracao: 3600, intervalo: 10, container: 'expediente', pid: undefined, saida: undefined, sobrescrever: false, ajuda: false };
  const inteiro = (nome, v) => {
    if (!/^[1-9]\d*$/.test(v ?? '')) throw new Error(`${nome} pede um inteiro positivo`);
    return Number(v);
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--ajuda' || a === '-h') o.ajuda = true;
    else if (a === '--duracao') o.duracao = inteiro(a, argv[++i]);
    else if (a === '--intervalo') o.intervalo = inteiro(a, argv[++i]);
    else if (a === '--pid') o.pid = inteiro(a, argv[++i]);
    else if (a === '--container') o.container = argv[++i];
    else if (a === '--saida') o.saida = resolve(argv[++i] ?? '');
    else if (a === '--sobrescrever') o.sobrescrever = true;
    else throw new Error(`opção desconhecida: ${a}`);
  }
  if (!o.container) throw new Error('--container pede um nome');
  return o;
}

/** Amostra a cada `intervalo` s por `duracao` s (a primeira amostra é imediata). */
export async function coletar({ duracao, intervalo }, amostrar, dormir) {
  const total = Math.floor(duracao / intervalo) + 1;
  const destinos = new Set();
  let falhas = 0;
  for (let i = 0; i < total; i++) {
    if (i > 0) await dormir(intervalo * 1000);
    try {
      for (const d of destinosExternos(await amostrar())) destinos.add(d);
    } catch {
      falhas++;
    }
  }
  return { amostras: total, falhas, destinos: [...destinos].sort() };
}

export function renderRelatorio({ inicio, fim, modo, duracao, intervalo, amostras, falhas, destinos }) {
  return [
    '# prova de rede: conexões TCP de saída do servidor',
    `inicio: ${inicio.toISOString()}`,
    `fim: ${fim.toISOString()}`,
    `modo: ${modo}`,
    `duracao: ${duracao} s, intervalo: ${intervalo} s`,
    `amostras: ${amostras} (falhas: ${falhas})`,
    '',
    ...(destinos.length ? destinos : ['nenhum destino fora do loopback']),
    '',
  ].join('\n');
}

function amostrador(o) {
  if (o.pid) {
    return async () => {
      const r = spawnSync('lsof', ['-nP', '-i', '-a', '-p', String(o.pid)], { encoding: 'utf8' });
      if (r.error || (r.status !== 0 && r.status !== 1)) throw new Error('lsof falhou');
      return parseLsof(r.stdout);
    };
  }
  return async () => {
    const lidos = ['/proc/net/tcp', '/proc/net/tcp6'].map((arq) => {
      const r = spawnSync('docker', ['exec', o.container, 'cat', arq], { encoding: 'utf8' });
      if (r.error || r.status !== 0) throw new Error(`docker exec falhou em ${arq}`);
      return parseProcNetTcp(r.stdout);
    });
    return lidos.flat();
  };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.ajuda) {
    console.log('uso: node scripts/prova-rede.mjs [--duracao 3600] [--intervalo 10] [--container expediente | --pid <pid>] [--saida <arquivo> [--sobrescrever]]');
    return 0;
  }
  if (o.saida && existsSync(o.saida) && !o.sobrescrever) throw new Error(`${o.saida} já existe: use --sobrescrever para trocar`);
  const modo = o.pid ? `nativo (pid ${o.pid})` : `container ${o.container}`;
  const inicio = new Date();
  const r = await coletar(o, amostrador(o), (ms) => new Promise((ok) => setTimeout(ok, ms)));
  const texto = renderRelatorio({ inicio, fim: new Date(), modo, duracao: o.duracao, intervalo: o.intervalo, ...r });
  if (o.saida) {
    mkdirSync(dirname(o.saida), { recursive: true });
    writeFileSync(o.saida, texto, { flag: o.sobrescrever ? 'w' : 'wx' });
  }
  process.stdout.write(texto);
  return r.destinos.length ? 1 : r.falhas ? 2 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(e.message);
      process.exit(2);
    },
  );
}
