// Configuração do servidor a partir das variáveis de ambiente (documentadas em server/README.md).
import { existsSync, readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverClaudeDirs } from './accounts/detect';

export interface ServerConfig {
  port: number;
  host: string;
  /** `--dev`: Vite em middleware mode (HMR) no mesmo servidor. */
  dev: boolean;
  /** Liga o simulador de demonstração ao iniciar. */
  demo: boolean;
  /** Rodando dentro de um container (PIDs do registro são do host: não dá para checá-los). */
  inDocker: boolean;
  home: string;
  /** Config dirs do Claude Code observados (um por conta). */
  claudeDirs: string[];
  /** Onde o Expediente guarda o próprio estado (nomes persistidos). */
  dataDir: string;
  /**
   * Pasta com o uso capturado pelo statusline do Claude Code (scripts/statusline-tap.mjs):
   * EXPEDIENTE_USAGE_DIR ou ~/.expediente/host/uso. No Docker, o docker-up monta ~/.expediente/host em /host e o servidor lê /host/uso.
   */
  usageDir: string;
  /**
   * Terminal somente leitura (GET /api/agents/:id/terminal) ligado; EXPEDIENTE_TERMINAL=0 desliga (ver terminalOffReason).
   */
  terminal: boolean;
  /** Grava a linha do tempo do escritório para o timelapse (<dataDir>/timeline); EXPEDIENTE_TIMELINE=0 desliga. */
  timeline: boolean;
  /** Raiz do projeto (onde fica o package.json); serve dist/client a partir daqui. */
  rootDir: string;
  version: string;
}

export function isTruthy(v: string | undefined): boolean {
  return !!v && /^(1|true|yes|sim|on)$/i.test(v.trim());
}

/** Sobe a partir de `from` até achar o package.json do projeto. */
export function findRoot(from: string): string {
  let dir = from;
  for (let i = 0; i < 6; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        const name = (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: unknown }).name;
        if (name === 'expediente') return dir;
      } catch {
        // package.json ilegível: continua subindo
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return resolve(from, '..');
}

/** Versão e repositório do package.json. */
function readPackage(rootDir: string): { version: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')) as { version?: unknown };
    return { version: typeof pkg.version === 'string' ? pkg.version : '0.0.0' };
  } catch {
    return { version: '0.0.0' };
  }
}

export function detectDocker(): boolean {
  return existsSync('/.dockerenv');
}

/**
 * Endereço de escuta que só o próprio computador alcança: 127.0.0.0/8, `::1` (com ou sem colchetes)
 * ou `localhost`. `0.0.0.0`, `::`, IPs de rede e nomes quaisquer não contam.
 */
export function isLoopbackBind(value: string | undefined): boolean {
  let v = value?.trim().toLowerCase() ?? '';
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
  if (v === 'localhost') return true;
  const family = isIP(v);
  if (family === 4) return v.startsWith('127.');
  if (family !== 6) return false;
  try {
    // Forma canônica (0:0:0:0:0:0:0:1 -> [::1]; ::ffff:127.0.0.1 -> [::ffff:7f00:1]).
    const canonical = new URL(`http://[${v}]/`).hostname;
    return canonical === '[::1]' || /^\[::ffff:7f[0-9a-f]{2}:[0-9a-f]{1,4}\]$/.test(canonical);
  } catch {
    return false;
  }
}

/**
 * Por que o terminal somente leitura fica desligado (undefined = ligado). A porta só é alcançável pelo próprio
 * computador (loopback fixo no Node; publicação em 127.0.0.1 no compose), então só EXPEDIENTE_TERMINAL com
 * qualquer valor que não seja "ligado" (0, false, off...) desliga.
 */
export function terminalOffReason(env: NodeJS.ProcessEnv): string | undefined {
  const flag = env.EXPEDIENTE_TERMINAL?.trim();
  return flag && !isTruthy(flag) ? `EXPEDIENTE_TERMINAL=${flag}` : undefined;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv, inDocker: boolean = detectDocker()): ServerConfig {
  const home = env.HOME || homedir();
  const port = Number.parseInt(env.EXPEDIENTE_PORT ?? '', 10);
  const rootDir = findRoot(dirname(fileURLToPath(import.meta.url)));
  const host = inDocker ? '0.0.0.0' : '127.0.0.1';
  const pkg = readPackage(rootDir);
  return {
    port: Number.isFinite(port) && port > 0 && port < 65536 ? port : 4848,
    host,
    dev: argv.includes('--dev'),
    demo: isTruthy(env.EXPEDIENTE_DEMO),
    inDocker,
    home,
    claudeDirs: discoverClaudeDirs(env, home),
    dataDir: resolve(env.EXPEDIENTE_DATA_DIR?.trim() || (inDocker ? '/data' : join(home, '.expediente'))),
    usageDir: resolve(env.EXPEDIENTE_USAGE_DIR?.trim() || join(home, '.expediente', 'host', 'uso')),
    terminal: terminalOffReason(env) === undefined,
    timeline: !env.EXPEDIENTE_TIMELINE?.trim() || isTruthy(env.EXPEDIENTE_TIMELINE),
    rootDir,
    version: pkg.version,
  };
}
