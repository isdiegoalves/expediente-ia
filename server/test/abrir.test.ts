import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { Autenticacao } from '../http/autenticacao';
import { createRequestGuard } from '../http/guard';
import { chaveDoToken, type TokenLido } from '../token';

const SCRIPT = resolve(__dirname, '../../scripts/abrir.mjs');
const TOKEN = '5e17e11a'.repeat(8);
const OUTRO = 'f'.repeat(64);

interface Resultado {
  codigo: number;
  linhas: string[];
}
const { abrir, comandoDeAbrir, htmlDoEscritorio, iniciarLimpeza, portaDe, urlDoEscritorio } = (await import(pathToFileURL(SCRIPT).href)) as {
  abrir(o: { env?: NodeJS.ProcessEnv; home: string; plataforma?: string; executar(c: string, a: string[]): number; limpar?(pasta: string): void }): Promise<Resultado>;
  comandoDeAbrir(p: string): string;
  htmlDoEscritorio(url: string): string;
  iniciarLimpeza(pasta: string, ms?: number): void;
  portaDe(env: NodeJS.ProcessEnv): number;
  urlDoEscritorio(bilhete: string, porta: number): string;
};

const lido = (token: string): TokenLido => ({ ok: true, token, chave: chaveDoToken(token) });

interface Servidor {
  porta: number;
  /** Tudo o que chegou: método, URL, cabeçalhos e corpo. */
  brutos: string[];
  auth: Autenticacao;
  close(): Promise<void>;
}

/** O guard e a autenticação de verdade, num servidor que anota cada byte do pedido. `bilhete500` faz a rota do bilhete falhar depois da prova. */
async function servidor(token: string, opts: { semAuth?: boolean } = {}): Promise<Servidor> {
  const auth = new Autenticacao(() => lido(token));
  const guard = createRequestGuard(auth);
  const brutos: string[] = [];
  const srv = http.createServer((req, res) => {
    const pedacos: Buffer[] = [];
    req.on('data', (c: Buffer) => pedacos.push(c));
    req.on('end', () => brutos.push(`${req.method} ${req.url}\n${JSON.stringify(req.headers)}\n${Buffer.concat(pedacos).toString('utf8')}`));
    if (guard(req, res)) return;
    res.writeHead(opts.semAuth ? 500 : 200, { 'Content-Type': 'application/json' }).end('{}');
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
  return { porta: (srv.address() as AddressInfo).port, brutos, auth, close: () => new Promise<void>((ok) => (srv.closeAllConnections(), srv.close(() => ok()))) };
}

function homeCom(token: string | undefined): { home: string; limpar(): void } {
  const home = mkdtempSync(join(tmpdir(), 'expediente-abrir-'));
  mkdirSync(join(home, '.expediente', 'host'), { recursive: true });
  if (token !== undefined) writeFileSync(join(home, '.expediente', 'host', 'token'), token, { mode: 0o600 });
  return { home, limpar: () => rmSync(home, { recursive: true, force: true }) };
}

const limpezas: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const l of limpezas.splice(0)) await l();
});
const comHome = (token: string | undefined) => {
  const h = homeCom(token);
  limpezas.push(h.limpar);
  return h.home;
};
const comServidor = async (token: string, opts?: { semAuth?: boolean }) => {
  const s = await servidor(token, opts);
  limpezas.push(s.close);
  return s;
};

describe('abrir: funções', () => {
  it('a URL leva o bilhete no fragmento do IP literal; a porta vem de EXPEDIENTE_PORT ou é 4848', () => {
    const b = '00112233445566778899aabbccddeeff';
    expect(urlDoEscritorio(b, 4848)).toBe(`http://127.0.0.1:4848/#b=${b}`);
    expect([portaDe({}), portaDe({ EXPEDIENTE_PORT: '5000' }), portaDe({ EXPEDIENTE_PORT: 'x' }), portaDe({ EXPEDIENTE_PORT: '70000' }), portaDe({ EXPEDIENTE_PORT: '0' })]).toEqual([4848, 5000, 4848, 4848, 4848]);
    expect(htmlDoEscritorio(urlDoEscritorio(b, 4848)).split(urlDoEscritorio(b, 4848))).toHaveLength(3);
  });

  it('open no macOS, xdg-open no resto', () => {
    expect([comandoDeAbrir('darwin'), comandoDeAbrir('linux')]).toEqual(['open', 'xdg-open']);
  });

  it('sem token válido não abre nada e diz o que fazer', async () => {
    for (const token of [undefined, 'curto', TOKEN.toUpperCase()]) {
      const chamadas: string[][] = [];
      const r = await abrir({ home: comHome(token), env: {}, executar: (c, a) => (chamadas.push([c, ...a]), 0) });
      expect(r.codigo).toBe(1);
      expect(chamadas).toEqual([]);
      expect(r.linhas.join('\n')).toContain('npm run docker:up');
    }
  });

  it('com o servidor de verdade: abre só o caminho do arquivo, entrega a pasta para limpar, e nenhuma linha impressa tem o token nem o bilhete', async () => {
    const s = await comServidor(TOKEN);
    const chamadas: string[][] = [];
    const pastas: string[] = [];
    const r = await abrir({ home: comHome(`${TOKEN}\n`), env: { EXPEDIENTE_PORT: String(s.porta) }, plataforma: 'darwin', executar: (c, a) => (chamadas.push([c, ...a]), 0), limpar: (p) => void pastas.push(p) });
    limpezas.push(() => rmSync(pastas[0]!, { recursive: true, force: true }));
    expect(r.codigo).toBe(0);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]![0]).toBe('open');
    expect(chamadas[0]![1]).toBe(join(pastas[0]!, 'abrir.html'));
    expect(chamadas[0]).toHaveLength(2);
    const html = readFileSync(chamadas[0]![1]!, 'utf8');
    const bilhete = /#b=([0-9a-f]{32})/.exec(html)![1]!;
    expect(r.linhas.join('\n') + chamadas.join('\n')).not.toContain(TOKEN);
    expect(r.linhas.join('\n') + chamadas.join('\n')).not.toContain(bilhete);
  });

  it('se o open falha, a pasta temporária some na hora e a limpeza não é agendada', async () => {
    const s = await comServidor(TOKEN);
    const pastas: string[] = [];
    let arquivo = '';
    const r = await abrir({ home: comHome(`${TOKEN}\n`), env: { EXPEDIENTE_PORT: String(s.porta) }, executar: (_c, a) => ((arquivo = a[0]!), 3), limpar: (p) => void pastas.push(p) });
    expect(r.codigo).toBe(1);
    expect(r.linhas.join('\n')).toContain('Não consegui abrir');
    expect(existsSync(arquivo)).toBe(false);
    expect(pastas).toEqual([]);
  });

  it('a limpeza apaga a pasta quando o bilhete vence', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'expediente-abrir.'));
    writeFileSync(join(pasta, 'abrir.html'), 'x');
    iniciarLimpeza(pasta, 700);
    expect(existsSync(pasta)).toBe(true);
    for (let i = 0; i < 40 && existsSync(pasta); i++) await new Promise((ok) => setTimeout(ok, 100));
    expect(existsSync(pasta)).toBe(false);
  });
});

describe('abrir: o script de verdade, contra o servidor de verdade (com um "open" falso no PATH, sem abrir navegador)', () => {
  /** O "open" falso anota o argv, os modos da pasta e do arquivo e o HTML, e não abre nada. */
  async function rodar(home: string, porta: number, script = SCRIPT) {
    const bin = mkdtempSync(join(tmpdir(), 'expediente-bin-'));
    limpezas.push(() => rmSync(bin, { recursive: true, force: true }));
    const registro = join(bin, 'registro.json');
    writeFileSync(
      join(bin, 'open'),
      `#!${process.execPath}\nconst fs = require('node:fs'); const path = require('node:path'); const arq = process.argv[2];\nfs.writeFileSync(${JSON.stringify(registro)}, JSON.stringify({ argv: process.argv.slice(2), pasta: fs.statSync(path.dirname(arq)).mode & 0o777, arquivo: fs.statSync(arq).mode & 0o777, html: fs.readFileSync(arq, 'utf8') }));\n`,
    );
    chmodSync(join(bin, 'open'), 0o755);
    // Assíncrono: o servidor de teste roda neste mesmo processo e precisa responder enquanto o script espera.
    const r = await new Promise<{ status: number | null; saida: string }>((ok, fail) => {
      const filho = spawn(process.execPath, [script], { env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home, EXPEDIENTE_PORT: String(porta) } });
      let saida = '';
      filho.stdout.setEncoding('utf8').on('data', (c: string) => (saida += c));
      filho.stderr.setEncoding('utf8').on('data', (c: string) => (saida += c));
      filho.on('error', fail);
      filho.on('close', (status) => ok({ status, saida }));
    });
    const aberto = existsSync(registro) ? (JSON.parse(readFileSync(registro, 'utf8')) as { argv: string[]; pasta: number; arquivo: number; html: string }) : undefined;
    if (aberto) limpezas.push(() => rmSync(join(aberto.argv[0]!, '..'), { recursive: true, force: true }));
    return { status: r.status, saida: r.saida, aberto };
  }

  it('abre o arquivo (pasta 700, arquivo 600) com um bilhete que o servidor troca uma vez pelo segredo; o argv, a saída e o que o servidor recebeu não têm o segredo nem o bilhete', async () => {
    const s = await comServidor(TOKEN);
    const r = await rodar(comHome(`${TOKEN}\n`), s.porta);
    expect(r.status).toBe(0);
    const a = r.aberto!;
    expect(a.argv).toHaveLength(1);
    expect(a.argv[0]).toMatch(/\/expediente-abrir\.[A-Za-z0-9]+\/abrir\.html$/);
    expect(a.pasta).toBe(0o700);
    expect(a.arquivo).toBe(0o600);
    const bilhete = new RegExp(`http://127\\.0\\.0\\.1:${s.porta}/#b=([0-9a-f]{32})`).exec(a.html)![1]!;
    expect(a.html).not.toContain(TOKEN);
    expect(r.saida + a.argv.join(' ')).not.toContain(TOKEN);
    expect(r.saida + a.argv.join(' ')).not.toContain(bilhete);
    // O que o servidor recebeu: o desafio, depois o POST do bilhete com a prova; o token nunca.
    expect(s.brutos).toHaveLength(2);
    expect(s.brutos[0]).toMatch(/^GET \/api\/token\/desafio\?n=[0-9a-f]{32}\n/);
    expect(s.brutos[1]).toMatch(/^POST \/api\/token\/bilhete\n/);
    expect(s.brutos[1]).toMatch(/"x-expediente-prova":"[0-9a-f]{32}\.[0-9a-f]{64}"/);
    expect(s.brutos.join('\n')).not.toContain(TOKEN);
    // O bilhete serve uma vez: a troca devolve o segredo e a segunda tentativa não.
    const troca = (b: string) => fetch(`http://127.0.0.1:${s.porta}/api/token/troca`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bilhete: b }) });
    expect(await (await troca(bilhete)).json()).toEqual({ token: TOKEN });
    expect((await troca(bilhete)).status).toBe(401);
  });

  it('servidor que não tem o token (quem ocupa a porta com o Expediente parado): não abre nada, diz que não é o Expediente, e o servidor só vê o desafio, sem prova nem segredo', async () => {
    const impostor = await comServidor(OUTRO);
    const r = await rodar(comHome(`${TOKEN}\n`), impostor.porta);
    expect(r.status).toBe(1);
    expect(r.aberto).toBeUndefined();
    expect(r.saida).toContain(`Quem responde na porta ${impostor.porta} não é o seu Expediente`);
    expect(impostor.brutos).toHaveLength(1);
    expect(impostor.brutos[0]).toMatch(/^GET \/api\/token\/desafio/);
    expect(impostor.brutos.join('\n')).not.toContain(TOKEN);
    expect(impostor.brutos.join('\n').toLowerCase()).not.toContain('x-expediente-prova');
    expect(r.saida).not.toContain(TOKEN);
  });

  it('servidor que prova mas recusa o bilhete: não abre nada e diz o status', async () => {
    const s = await comServidor(TOKEN);
    s.auth.tratar = (_rota, _req, res) => void res.writeHead(500).end('{}');
    const r = await rodar(comHome(`${TOKEN}\n`), s.porta);
    expect(r.status).toBe(1);
    expect(r.aberto).toBeUndefined();
    expect(r.saida).toContain('HTTP 500');
  });

  it('sem servidor: sai com 1 e manda subir; sem o arquivo do token: sai com 1 e manda criar', async () => {
    const livre = await comServidor(TOKEN);
    const porta = livre.porta;
    await livre.close();
    const semServidor = await rodar(comHome(`${TOKEN}\n`), porta);
    expect(semServidor.status).toBe(1);
    expect(semServidor.aberto).toBeUndefined();
    expect(semServidor.saida).toContain('npm run docker:up');
    const semArquivo = await rodar(comHome(undefined), porta);
    expect(semArquivo.status).toBe(1);
    expect(semArquivo.saida).toContain('npm run docker:up');
    expect(statSync(tmpdir()).isDirectory()).toBe(true);
  });

  it('roda de qualquer pasta, só com node, sobre um git archive sem node_modules (como a cópia que o npm run instalar faz), e a cópia inclui o script', async () => {
    const raiz = resolve(__dirname, '../..');
    for (const arquivo of ['scripts/abrir.mjs', 'mod/expediente-permissoes/hooks/permission-hook.mjs']) {
      const rastreado = spawnSync('git', ['ls-files', '--error-unmatch', arquivo], { cwd: raiz });
      expect(rastreado.status, `${arquivo} precisa estar versionado`).toBe(0);
      const atributo = spawnSync('git', ['check-attr', 'export-ignore', arquivo], { cwd: raiz, encoding: 'utf8' });
      expect(atributo.stdout, arquivo).toMatch(/export-ignore: unspecified/);
    }
    const copia = mkdtempSync(join(tmpdir(), 'expediente-copia-'));
    limpezas.push(() => rmSync(copia, { recursive: true, force: true }));
    const tar = spawnSync('sh', ['-c', `git archive HEAD scripts/abrir.mjs mod/expediente-permissoes | tar -x -C "${copia}"`], { cwd: raiz });
    expect(tar.status).toBe(0);
    expect(existsSync(join(copia, 'node_modules'))).toBe(false);
    const s = await comServidor(TOKEN);
    const r = await rodar(comHome(`${TOKEN}\n`), s.porta, join(copia, 'scripts/abrir.mjs'));
    expect(r.status, r.saida).toBe(0);
    expect(r.aberto!.argv[0]).toMatch(/\/abrir\.html$/);
  });
});
