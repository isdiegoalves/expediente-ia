import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');

interface Conexao {
  local: string;
  localPort: number;
  remoto: string;
  remotoPort: number;
  escuta: boolean;
}
const prova = (await import(join(ROOT, 'scripts/prova-rede.mjs'))) as {
  isLoopback: (ip: string) => boolean;
  parseProcNetTcp: (t: string) => Conexao[];
  parseLsof: (t: string) => Conexao[];
  destinosExternos: (c: Conexao[]) => string[];
  parseArgs: (a: string[]) => { duracao: number; intervalo: number; container: string; pid?: number; saida?: string; sobrescrever: boolean };
  coletar: (o: { duracao: number; intervalo: number }, amostrar: () => Promise<Conexao[]>, dormir: (ms: number) => Promise<void>) => Promise<{ amostras: number; falhas: number; destinos: string[] }>;
  renderRelatorio: (r: Record<string, unknown>) => string;
};

const CAB = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n';
const lin = (i: number, l: string, r: string, st: string) => `   ${i}: ${l} ${r} ${st} 00000000:00000000 00:00000000 00000000  1000        0 1 1 0000 100 0 0 10 0\n`;

describe('prova de rede: classificação', () => {
  it('loopback é 127/8, ::1 e ::ffff:127.x', () => {
    for (const ip of ['127.0.0.1', '127.8.9.10', '::1', '[::1]', '0:0:0:0:0:0:0:1', '::ffff:127.0.0.1', '0:0:0:0:0:ffff:7f00:1']) expect(prova.isLoopback(ip), ip).toBe(true);
    for (const ip of ['10.0.0.1', '128.0.0.1', '172.17.0.1', '8.8.8.8', '::', '::2', '::ffff:8.8.8.8', '2606:4700::1111', 'lixo', '']) expect(prova.isLoopback(ip), ip).toBe(false);
  });
});

describe('prova de rede: /proc/net/tcp', () => {
  it('lê endereços IPv4 em hexadecimal little-endian', () => {
    const t = CAB + lin(0, '0100007F:12F0', '0100007F:D431', '01') + lin(1, '0B00A8C0:D432', '08080808:01BB', '01');
    expect(prova.parseProcNetTcp(t)).toEqual([
      { local: '127.0.0.1', localPort: 0x12f0, remoto: '127.0.0.1', remotoPort: 0xd431, escuta: false },
      { local: '192.168.0.11', localPort: 0xd432, remoto: '8.8.8.8', remotoPort: 443, escuta: false },
    ]);
  });

  it('lê IPv6, incluindo ::1 e ::ffff:127.0.0.1', () => {
    const t =
      CAB +
      lin(0, '00000000000000000000000001000000:12F0', '00000000000000000000000001000000:D431', '01') +
      lin(1, '0000000000000000FFFF00000100007F:12F0', '0000000000000000FFFF00000100007F:D432', '01') +
      lin(2, '0000000000000000FFFF00000B00A8C0:D433', '0000000000000000FFFF000008080808:01BB', '01');
    const c = prova.parseProcNetTcp(t);
    expect(c.map((x) => prova.isLoopback(x.remoto))).toEqual([true, true, false]);
    expect(prova.destinosExternos(c)).toEqual(['[0:0:0:0:0:ffff:808:808]:443']);
  });

  it('escuta, sem par remoto e conexão aceita na porta em escuta não contam; saída para fora conta', () => {
    const t =
      CAB +
      lin(0, '00000000:12F0', '00000000:0000', '0A') +
      lin(1, '0100007F:D000', '00000000:0000', '07') +
      lin(2, '0200A8C0:12F0', '0900A8C0:E000', '01') +
      lin(3, '0200A8C0:D555', '08080808:01BB', '01') +
      lin(4, '0200A8C0:D556', '08080808:01BB', '06');
    expect(prova.destinosExternos(prova.parseProcNetTcp(t))).toEqual(['8.8.8.8:443']);
  });

  it('só loopback dá lista vazia', () => {
    const t = CAB + lin(0, '0100007F:12F0', '00000000:0000', '0A') + lin(1, '0100007F:12F0', '0100007F:D431', '01');
    expect(prova.destinosExternos(prova.parseProcNetTcp(t))).toEqual([]);
  });
});

describe('prova de rede: lsof', () => {
  const SAIDA = [
    'COMMAND   PID USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
    'node    41234 fulano   20u  IPv4 0xabc      0t0  TCP 127.0.0.1:4848 (LISTEN)',
    'node    41234 fulano   21u  IPv6 0xdef      0t0  TCP [::1]:4848->[::1]:50000 (ESTABLISHED)',
    'node    41234 fulano   22u  IPv4 0x123      0t0  TCP 127.0.0.1:4848->127.0.0.1:50001 (ESTABLISHED)',
    'node    41234 fulano   23u  IPv4 0x456      0t0  TCP 192.168.0.11:60000->140.82.112.3:443 (ESTABLISHED)',
    'node    41234 fulano   24u  IPv4 0x789      0t0  UDP *:5353',
    '',
  ].join('\n');

  it('lê escuta, pares e sockets sem par', () => {
    const c = prova.parseLsof(SAIDA);
    expect(c).toHaveLength(5);
    expect(c[0]).toMatchObject({ localPort: 4848, remoto: '', escuta: true });
    expect(c[1]).toMatchObject({ remoto: '::1', remotoPort: 50000, escuta: false });
    expect(c[3]).toMatchObject({ remoto: '140.82.112.3', remotoPort: 443 });
  });

  it('só o destino fora do loopback entra na lista', () => {
    expect(prova.destinosExternos(prova.parseLsof(SAIDA))).toEqual(['140.82.112.3:443']);
  });
});

describe('prova de rede: execução', () => {
  it('opções e padrões', () => {
    expect(prova.parseArgs([])).toMatchObject({ duracao: 3600, intervalo: 10, container: 'expediente', pid: undefined });
    expect(prova.parseArgs(['--duracao', '60', '--intervalo', '5', '--pid', '12'])).toMatchObject({ duracao: 60, intervalo: 5, pid: 12 });
    expect(() => prova.parseArgs(['--duracao', '0'])).toThrow(/inteiro positivo/);
    expect(prova.parseArgs([]).saida).toBeUndefined();
    expect(prova.parseArgs([]).sobrescrever).toBe(false);
    expect(prova.parseArgs(['--saida', 'x.txt', '--sobrescrever'])).toMatchObject({ saida: resolve('x.txt'), sobrescrever: true });
    expect(() => prova.parseArgs(['--x'])).toThrow(/opção desconhecida/);
  });

  it('amostra no começo e a cada intervalo, junta destinos e conta falhas', async () => {
    const esperas: number[] = [];
    let n = 0;
    const externo: Conexao = { local: '10.0.0.2', localPort: 5000, remoto: '1.2.3.4', remotoPort: 80, escuta: false };
    const r = await prova.coletar(
      { duracao: 30, intervalo: 10 },
      async () => {
        n++;
        if (n === 2) throw new Error('falhou');
        return n === 3 ? [externo, externo] : [];
      },
      async (ms) => void esperas.push(ms),
    );
    expect(r).toEqual({ amostras: 4, falhas: 1, destinos: ['1.2.3.4:80'] });
    expect(esperas).toEqual([10000, 10000, 10000]);
  });

  it('o script não grava sem --saida e recusa arquivo existente sem --sobrescrever', () => {
    const dir = mkdtempSync(join(tmpdir(), 'prova-rede-'));
    try {
      const alvo = join(dir, 'rede.txt');
      writeFileSync(alvo, 'prova anterior\n');
      const roda = (...extra: string[]) =>
        spawnSync(process.execPath, [join(ROOT, 'scripts/prova-rede.mjs'), '--pid', String(process.pid), '--duracao', '1', '--intervalo', '1', ...extra], { encoding: 'utf8' });
      const recusa = roda('--saida', alvo);
      expect(recusa.status).toBe(2);
      expect(recusa.stderr).toContain('--sobrescrever');
      expect(readFileSync(alvo, 'utf8')).toBe('prova anterior\n');
      const semSaida = roda();
      expect(semSaida.stdout).toContain('# prova de rede');
      expect(readdirSync(dir)).toEqual(['rede.txt']);
      const sobre = roda('--saida', alvo, '--sobrescrever');
      expect(sobre.stdout).toContain('# prova de rede');
      expect(readFileSync(alvo, 'utf8')).toContain('# prova de rede');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('relatório com cabeçalho e a linha de lista vazia', () => {
    const base = { inicio: new Date('2026-01-01T00:00:00Z'), fim: new Date('2026-01-01T01:00:00Z'), modo: 'container expediente', duracao: 3600, intervalo: 10, amostras: 361, falhas: 0 };
    const vazio = prova.renderRelatorio({ ...base, destinos: [] });
    expect(vazio).toContain('inicio: 2026-01-01T00:00:00.000Z');
    expect(vazio).toContain('modo: container expediente');
    expect(vazio).toContain('amostras: 361 (falhas: 0)');
    expect(vazio.trim().endsWith('nenhum destino fora do loopback')).toBe(true);
    expect(prova.renderRelatorio({ ...base, destinos: ['1.2.3.4:80'] })).not.toContain('nenhum destino');
  });
});

const CHAMADAS_DE_REDE: [string, RegExp][] = [
  ['fetch(', /(?<![\w$])fetch\s*\(/],
  ['http(s).request/get', /\bhttps?\.(request|get)\s*\(/],
  ['net.connect/createConnection', /\bnet\.(connect|createConnection)\s*\(/],
  ['tls.connect', /\btls\.connect\s*\(/],
  ['dgram', /\bdgram\b/],
  ['dns', /\bdns\.|node:dns/],
  ['WebSocket', /\bWebSocket\s*\(/],
];

const MODULOS = 'http|https|http2|net|tls|dns|dgram|child_process';
const MODULO_DE_REDE = new RegExp(`['"](?:node:)?(?:${MODULOS})(?:/promises)?['"]`);
const IMPORT_NOMEADO = new RegExp(`\\bimport\\s*\\{([^}]*)\\}\\s*from\\s*['"](?:node:)?(${MODULOS})(?:/promises)?['"]`, 'g');
const SO_TIPO = /\b(?:import|export)\s+type\b[\s\S]*?from\s*['"][^'"]+['"]/g;

// Só import nomeado, e só estes nomes. child_process fica fora de server/ e shared/.
const IMPORTS_PERMITIDOS: Record<string, Record<string, string[]>> = {
  'server/index.ts': { http: ['createServer'] },
  'server/config.ts': { net: ['isIP'] },
  'server/http/guard.ts': { net: ['isIP'] },
};

function fontesDeRuntime(): string[] {
  const achados: string[] = [];
  const varrer = (dir: string) => {
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) {
        if (nome === 'test' || nome === 'node_modules' || relative(ROOT, p) === 'shared/demo') continue;
        varrer(p);
      } else if (/\.(ts|mjs|js)$/.test(nome) && !/\.test\.ts$/.test(nome)) achados.push(p);
    }
  };
  varrer(join(ROOT, 'server'));
  varrer(join(ROOT, 'shared'));
  return achados;
}

function chamadasDeRede(codigo: string, permitidos: Record<string, string[]> = {}): string[] {
  const sem = codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const achadas = CHAMADAS_DE_REDE.filter(([, re]) => re.test(sem)).map(([nome]) => nome);
  const semTipos = sem.replace(SO_TIPO, '');
  let foraDaLista = false;
  const resto = semTipos.replace(IMPORT_NOMEADO, (_, nomes: string, modulo: string) => {
    for (const item of nomes.split(',').map((n) => n.trim())) {
      if (!item || item.startsWith('type ')) continue;
      if (!(permitidos[modulo] ?? []).includes(item.split(/\s+as\s+/)[0]!)) foraDaLista = true;
    }
    return '';
  });
  if (foraDaLista || MODULO_DE_REDE.test(resto)) achadas.push('módulo de rede de saída');
  return achadas;
}

describe('código do servidor não faz chamada de rede de saída', () => {
  it('há código de runtime para varrer', () => {
    expect(fontesDeRuntime().length).toBeGreaterThan(30);
  });

  it('nenhum arquivo de server/ e shared/ (fora testes e shared/demo) chama a rede', () => {
    const achados = fontesDeRuntime().flatMap((p) => chamadasDeRede(readFileSync(p, 'utf8'), IMPORTS_PERMITIDOS[relative(ROOT, p)]).map((c) => `${relative(ROOT, p)}: ${c}`));
    expect(achados).toEqual([]);
  });

  it('o detector pega cada forma de chamada e ignora comentário', () => {
    expect(chamadasDeRede("await fetch('https://x.example')")).toEqual(['fetch(']);
    expect(chamadasDeRede("import https from 'node:https'; https.get(u)")).toEqual(['http(s).request/get', 'módulo de rede de saída']);
    expect(chamadasDeRede("http.request({ host: 'x' })")).toEqual(['http(s).request/get']);
    expect(chamadasDeRede("net.connect(80, 'x')")).toEqual(['net.connect/createConnection']);
    expect(chamadasDeRede('tls.connect({})')).toEqual(['tls.connect']);
    expect(chamadasDeRede("import dgram from 'node:dgram'")).toContain('dgram');
    expect(chamadasDeRede("dns.lookup('x', cb)")).toEqual(['dns']);
    expect(chamadasDeRede("new WebSocket('wss://x')")).toEqual(['WebSocket']);
    for (const forma of [
      "import { get } from 'node:http';",
      "import { get as obter } from 'http';",
      "import {\n  request,\n} from 'node:https';",
      "import * as h from 'node:http';",
      "const { connect } = require('node:net');",
      "const h = await import('node:http');",
      "import { createConnection } from 'net';",
      "import { lookup } from 'node:dns/promises';",
      "import { connect } from 'node:tls';",
      "import { createSocket } from 'node:dgram';",
      "import { type Server, get } from 'node:http';",
      "export { get } from 'node:http';",
      "import 'node:http';",
    ]) expect(chamadasDeRede(forma), forma).toContain('módulo de rede de saída');
    expect(chamadasDeRede("import type { IncomingMessage } from 'node:http';")).toEqual([]);
    expect(chamadasDeRede("import type {\n  AddressInfo,\n} from 'node:net';")).toEqual([]);
    const livre = { http: ['createServer'], net: ['isIP'] };
    expect(chamadasDeRede("import { createServer, type Server } from 'node:http';", livre)).toEqual([]);
    expect(chamadasDeRede("import { isIP } from 'node:net';", livre)).toEqual([]);
    for (const forma of [
      "import { createServer, get } from 'node:http';",
      "import { get as obter } from 'node:http';",
      "import http from 'node:http';",
      "import { connect } from 'node:net';",
      "import { execFile } from 'node:child_process';",
      "import { spawnSync } from 'child_process';",
      "const cp = require('node:child_process');",
    ]) expect(chamadasDeRede(forma, livre), forma).toContain('módulo de rede de saída');
    expect(chamadasDeRede("// fetch('x')\n/* http.get(u) */ const a = 1;")).toEqual([]);
    expect(chamadasDeRede("res.fetchedAt = 1; refetch(); isIP('::1');")).toEqual([]);
  });
});
