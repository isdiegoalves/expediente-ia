#!/usr/bin/env node
// Prova do modo maquete no app construído (dist/client, ?mock=1) em Chromium headless, sem servidor: os arquivos
// saem do disco por page.route e qualquer outro host é recusado. Roda quatro casos e confere preferência,
// interruptor, dica e canvas de cada um. Sai com 1 se algum falhar.
//
//   npm run build:client && node scripts/prova-maquete.mjs
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const raizRepo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(join(raizRepo, 'package.json'))('playwright-core');
const completo = chromium.executablePath();
const shell = resolve(completo.slice(0, completo.indexOf('chromium-')), 'chromium_headless_shell-' + completo.match(/chromium-(\d+)/)[1], 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell');
const raiz = join(raizRepo, 'dist', 'client');
const tipos = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.webp': 'image/webp', '.ico': 'image/x-icon' };

const instrumento = (modo) => {
  window.__texto = {};
  const fillText = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (...a) {
    const id = this.canvas?.id || '(sem id)';
    window.__texto[id] = (window.__texto[id] ?? 0) + 1;
    return fillText.apply(this, a);
  };
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (tipo, ...r) {
    if (tipo === 'webgl2' && modo === 'nulo') return null;
    return getContext.call(this, tipo, ...r);
  };
};

const lerEstado = () =>
  document.fonts.ready.then(() => {
    const linha = [...document.querySelectorAll('#ui-settings .ui-set')].find((l) => l.textContent.includes('Modo maquete'));
    const btn = linha.querySelector('button');
    const prefs = Object.keys(localStorage).map((k) => { try { return JSON.parse(localStorage.getItem(k))?.maquete; } catch { return undefined; } }).filter((v) => v !== undefined);
    return {
      ligado: btn.getAttribute('aria-checked'),
      desativado: btn.disabled,
      falhou: linha.querySelector('.ui-set__hint').textContent.startsWith('O modo maquete não funcionou'),
      pref: prefs.join(),
      maquete: document.getElementById('maquete') !== null,
    };
  });

const esperado = {
  ligado: { ligado: 'true', desativado: false, falhou: false, pref: 'true', maquete: true },
  desligado: { ligado: 'false', desativado: false, falhou: false, pref: 'false', maquete: false },
  falhou: { ligado: 'false', desativado: true, falhou: true, pref: 'false', maquete: false },
};

let reprovado = false;
function conferir(rotulo, estado, quer) {
  const diverge = Object.keys(quer).filter((k) => String(estado[k]) !== String(quer[k]));
  const resumo = Object.entries(quer).map(([k]) => `${k}=${estado[k]}`).join(' ');
  console.log(`${diverge.length ? 'FALHA' : 'ok   '} ${rotulo}: ${resumo}${diverge.length ? `  (esperado ${diverge.map((k) => `${k}=${quer[k]}`).join(' ')})` : ''}`);
  if (diverge.length) reprovado = true;
}

async function caso(modo) {
  const perfil = mkdtempSync(join(tmpdir(), 'prova-maquete-'));
  const ctx = await chromium.launchPersistentContext(perfil, { executablePath: shell, headless: true, viewport: { width: 1280, height: 800 }, args: ['--disable-background-networking', '--no-first-run', '--enable-unsafe-swiftshader'] });
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await page.route('**/*', (rota) => {
      const u = new URL(rota.request().url());
      if (u.hostname !== 'expediente.test') return rota.abort();
      const arq = join(raiz, u.pathname === '/' ? 'index.html' : decodeURIComponent(u.pathname));
      if (!arq.startsWith(raiz) || !existsSync(arq) || !statSync(arq).isFile()) return rota.fulfill({ status: 404, body: '' });
      return rota.fulfill({ status: 200, contentType: tipos[extname(arq)] ?? 'application/octet-stream', body: readFileSync(arq) });
    });
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e).slice(0, 160)));
    await page.addInitScript(instrumento, modo);
    await page.goto('http://expediente.test/?mock=1&sessions=10');
    const abrir = 'button[aria-label="Configurações"], button[title="Configurações"]';
    await page.waitForSelector(abrir, { timeout: 20000 });
    await page.waitForTimeout(1500);
    await page.click(abrir);
    await page.waitForTimeout(300);
    const clicar = () => page.evaluate(() => [...document.querySelectorAll('#ui-settings .ui-set')].find((l) => l.textContent.includes('Modo maquete')).querySelector('button').click());
    const estado = async () => { await page.waitForTimeout(900); return page.evaluate(lerEstado); };

    if (modo === 'interruptor') {
      conferir('interruptor: antes', await estado(), { ligado: 'false', desativado: false, falhou: false, maquete: false });
      await clicar();
      conferir('interruptor: ligado', await estado(), esperado.ligado);
      await clicar();
      conferir('interruptor: desligado', await estado(), esperado.desligado);
      await clicar();
      conferir('interruptor: ligado de novo', await estado(), esperado.ligado);
    } else {
      await clicar();
      if (modo === 'perdido') {
        conferir('perdido: ligado antes da perda', await estado(), esperado.ligado);
        await page.evaluate(() => document.getElementById('maquete').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
      }
      const depois = await estado();
      conferir(`${modo}: depois da falha`, depois, esperado.falhou);
      await page.evaluate(() => (window.__texto = {}));
      await page.waitForTimeout(600);
      const overlay = await page.evaluate(() => window.__texto);
      const noMundo = (overlay.world ?? 0) > 0 && !overlay['maquete-overlay'];
      conferir(`${modo}: overlay de volta ao mundo`, { noMundo }, { noMundo: true });
    }
    if (erros.length) { console.log('FALHA erros de página: ' + JSON.stringify(erros)); reprovado = true; }
  } finally {
    await ctx.close();
    rmSync(perfil, { recursive: true, force: true });
  }
}

if (!existsSync(join(raiz, 'index.html'))) {
  console.error('dist/client não existe: rode `npm run build:client` antes.');
  process.exit(2);
}
for (const modo of ['interruptor', 'nulo', 'perdido']) await caso(modo);
process.exit(reprovado ? 1 : 0);
