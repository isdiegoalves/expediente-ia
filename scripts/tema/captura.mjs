// Capturas do tema candidato para o avaliador: um navegador da família Chromium, sem janela, abre a página em modo
// demonstração (?mock=1, nunca o escritório real) com o tema em prévia e enquadra uma sala por captura.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { delimiter, join, sep } from 'node:path';
import { cadeiaSegura, criarPasta, gravarArquivoComum, idValido } from './confinar.mjs';
import { ehPng } from './png.mjs';

export const SEM_NAVEGADOR = 3;
export const SEM_PREVIA = 4;
export const SEM_CAPTURA = 5;

const SALAS = [1, 2, 3];
const TENTATIVAS = 3;
const MAX_CAPTURA = 8 * 1024 * 1024;
const APLICATIVOS = ['Google Chrome.app/Contents/MacOS/Google Chrome', 'Microsoft Edge.app/Contents/MacOS/Microsoft Edge', 'Brave Browser.app/Contents/MacOS/Brave Browser', 'Chromium.app/Contents/MacOS/Chromium'];
const NOMES_NO_PATH = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'microsoft-edge', 'brave-browser'];

const falha = (codigo, mensagem) => Object.assign(new Error(mensagem), { codigo });
const executavel = (caminho) => {
  try {
    accessSync(caminho, constants.X_OK);
    return statSync(caminho).isFile();
  } catch {
    return false;
  }
};

/** O primeiro navegador Chromium instalado: nas pastas de aplicativos (EXPEDIENTE_APLICATIVOS, padrão /Applications e ~/Applications) e depois no PATH. */
export function acharNavegador(env = process.env) {
  const pastas = (env.EXPEDIENTE_APLICATIVOS ?? `/Applications${delimiter}${join(homedir(), 'Applications')}`).split(delimiter).filter(Boolean);
  for (const pasta of pastas) for (const app of APLICATIVOS) if (executavel(join(pasta, app))) return join(pasta, app);
  for (const pasta of (env.PATH ?? '').split(delimiter).filter(Boolean)) for (const nome of NOMES_NO_PATH) if (executavel(join(pasta, nome))) return join(pasta, nome);
  return undefined;
}

export const urlDaPrevia = (host, porta, id, consulta = '') => `http://${host}:${porta}/?${consulta}tema=${id}`;

export function argsDoNavegador({ perfil, saida, url }) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--force-prefers-reduced-motion',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    '--disable-sync',
    '--disable-breakpad',
    '--disable-background-networking',
    '--use-mock-keychain',
    '--password-store=basic',
    `--user-data-dir=${perfil}`,
    `--disk-cache-dir=${join(perfil, 'cache')}`,
    '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1',
    '--window-size=1440,900',
    '--force-device-scale-factor=1',
    '--virtual-time-budget=12000',
    `--screenshot=${saida}`,
    url,
  ];
}

const umaLinha = (s) => String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim().slice(0, 300);

/**
 * Trava dos testes: só eles definem EXPEDIENTE_TESTE_NAVEGADOR_DIR. Com ela, nenhum executável fora dessa pasta (depois
 * de seguir links) é lançado, qualquer que seja o jeito que a procura o tenha achado.
 */
function conferirTrava(navegador, env) {
  const dir = env.EXPEDIENTE_TESTE_NAVEGADOR_DIR;
  if (dir === undefined) return;
  const real = (c) => {
    try {
      return realpathSync(c);
    } catch {
      return c;
    }
  };
  if (!dir || !real(navegador).startsWith(real(dir) + sep)) throw new Error(`o navegador ${navegador} está fora da pasta de navegadores falsos dos testes; não foi executado`);
}

function lancar(navegador, args, env, limiteMs) {
  conferirTrava(navegador, env);
  // O navegador roda com o HOME verdadeiro do usuário (o do sistema, não o da variável de ambiente): com outro HOME ele
  // não acha as chaves do usuário e o macOS abre a janela do chaveiro. Os temas continuam na pasta de quem chamou.
  return spawnSync(navegador, args, { env: { PATH: env.PATH ?? '', HOME: userInfo().homedir }, stdio: ['ignore', 'ignore', 'pipe'], timeout: limiteMs, killSignal: 'SIGKILL', encoding: 'utf8' });
}

/** O servidor local aceita o candidato como prévia? Lança com código próprio se não responde ou o recusa. */
async function conferirPrevia(porta, id) {
  let corpo;
  try {
    const res = await fetch(`http://127.0.0.1:${porta}/api/tema?previa=${id}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    corpo = await res.json();
  } catch {
    throw falha(SEM_PREVIA, `O Expediente não respondeu em http://127.0.0.1:${porta}. Suba o Expediente e rode de novo.`);
  }
  if (corpo?.id !== id || corpo.aviso) {
    throw falha(SEM_PREVIA, `O Expediente recusou a prévia do tema "${id}": ${umaLinha(corpo?.aviso ?? 'resposta inesperada')}`);
  }
}

/**
 * Grava `temas/<id>/previa/sala-<n>.png` (n de 1 a 3) com o tema em prévia, no modo demonstração. O navegador escreve
 * numa pasta temporária, apagada no fim junto com o perfil; só um PNG conferido entra na pasta do tema.
 */
export async function capturar({ id, porta, home = homedir(), env = process.env, aviso = () => {}, limiteMs = 40_000 }) {
  idValido(id);
  cadeiaSegura(home, id);
  if (!existsSync(join(home, '.expediente', 'host', 'temas', id, 'tema.json'))) throw new Error(`o tema "${id}" não existe em ~/.expediente/host/temas`);
  const navegador = acharNavegador(env);
  if (!navegador) throw falha(SEM_NAVEGADOR, 'Nenhum navegador Chromium (Chrome, Edge, Brave ou Chromium) foi encontrado: nada foi capturado.');
  await conferirPrevia(porta, id);
  criarPasta(home, id, 'previa');
  const temporaria = mkdtempSync(join(tmpdir(), 'expediente-captura-'));
  const gravadas = [];
  try {
    for (const n of SALAS) {
      const saida = join(temporaria, `sala-${n}.png`);
      let png;
      let r;
      // O navegador às vezes trava na partida (visto no Chrome do macOS sob carga): quem passa do limite é morto e tenta de novo.
      for (let tentativa = 1; tentativa <= TENTATIVAS && !png; tentativa++) {
        r = lancar(navegador, argsDoNavegador({ perfil: join(temporaria, `perfil-${n}-${tentativa}`), saida, url: urlDaPrevia('127.0.0.1', porta, id, `mock=1&sessions=10&seed=12&sala=${n}&`) }), env, limiteMs);
        try {
          if (statSync(saida).size <= MAX_CAPTURA) png = readFileSync(saida);
        } catch {
          // sem arquivo: tenta de novo se o navegador estourou o limite, senão cai na mensagem abaixo
        }
        if (png && !ehPng(png)) png = undefined;
        if (!png && r.error?.code !== 'ETIMEDOUT') break;
      }
      if (!png) throw falha(SEM_CAPTURA, `O navegador não gerou a captura da sala ${n} (${r.error?.code === 'ETIMEDOUT' ? `passou de ${String(limiteMs / 1000).replace(".", ",")} s, ${TENTATIVAS} vezes` : `saída ${r.status ?? r.signal}`}): ${umaLinha(r.stderr ?? '')}`);
      // A pasta é conferida de novo a cada gravação: o navegador leva minutos e previa/ pode ter virado link nesse tempo.
      const destino = join(criarPasta(home, id, 'previa'), `sala-${n}.png`);
      gravarArquivoComum(destino, png);
      gravadas.push(destino);
      aviso(destino);
    }
  } finally {
    rmSync(temporaria, { recursive: true, force: true });
  }
  return gravadas;
}
