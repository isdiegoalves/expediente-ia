// Capturas do tema candidato para o avaliador: um navegador da família Chromium, sem janela, abre a página em modo
// demonstração (?mock=1, nunca o escritório real) com o tema em prévia e enquadra uma sala por captura.
import { spawnSync } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { cadeiaSegura, criarPasta, gravarArquivoComum, idValido } from './confinar.mjs';
import { ehPng } from './png.mjs';

export const SEM_NAVEGADOR = 3;
export const SEM_PREVIA = 4;
export const SEM_CAPTURA = 5;

const SALAS = [1, 2, 3];
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
export async function capturar({ id, porta, home = homedir(), env = process.env, aviso = () => {} }) {
  idValido(id);
  cadeiaSegura(home, id);
  if (!existsSync(join(home, '.expediente', 'host', 'temas', id, 'tema.json'))) throw new Error(`o tema "${id}" não existe em ~/.expediente/host/temas`);
  const navegador = acharNavegador(env);
  if (!navegador) throw falha(SEM_NAVEGADOR, 'Nenhum navegador Chromium (Chrome, Edge, Brave ou Chromium) foi encontrado: nada foi capturado.');
  await conferirPrevia(porta, id);
  const pasta = criarPasta(home, id, 'previa');
  const temporaria = mkdtempSync(join(tmpdir(), 'expediente-captura-'));
  const gravadas = [];
  try {
    for (const n of SALAS) {
      const saida = join(temporaria, `sala-${n}.png`);
      const r = spawnSync(navegador, argsDoNavegador({ perfil: join(temporaria, `perfil-${n}`), saida, url: urlDaPrevia('127.0.0.1', porta, id, `mock=1&sessions=10&seed=12&sala=${n}&`) }), {
        env: { PATH: env.PATH ?? '', HOME: env.HOME ?? home },
        stdio: ['ignore', 'ignore', 'pipe'],
        timeout: 90_000,
        killSignal: 'SIGKILL',
        encoding: 'utf8',
      });
      let png;
      try {
        if (statSync(saida).size <= MAX_CAPTURA) png = readFileSync(saida);
      } catch {
        // sem arquivo: cai na mensagem abaixo
      }
      if (!png || !ehPng(png)) throw falha(SEM_CAPTURA, `O navegador não gerou a captura da sala ${n} (saída ${r.status ?? r.signal}): ${umaLinha(r.stderr ?? '')}`);
      const destino = join(pasta, `sala-${n}.png`);
      gravarArquivoComum(destino, png);
      gravadas.push(destino);
      aviso(destino);
    }
  } finally {
    rmSync(temporaria, { recursive: true, force: true });
  }
  return gravadas;
}
