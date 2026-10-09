import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Tema } from '../../shared/tema/validar';
import { loadConfig } from '../config';
import { createTemaHandler } from '../http/tema';
import { arquivoDoTema, carregarTema } from '../tema/carregar';
import { tempDir } from './fixtures';

const PADRAO_DIR = resolve(__dirname, '../../client/public/temas/padrao');
const padrao = (): Tema => JSON.parse(readFileSync(join(PADRAO_DIR, 'tema.json'), 'utf8'));

const limpezas: (() => void)[] = [];
afterEach(() => limpezas.splice(0).forEach((f) => f()));

/** Host com um tema "teste" (e `tema-ativo` apontando para ele, a menos que `ativo` seja outro texto). */
function host(mexe: (t: Tema) => void = () => {}, ativo: string | null = 'teste') {
  const tmp = tempDir();
  limpezas.push(tmp.cleanup);
  const pasta = join(tmp.dir, 'temas', 'teste');
  mkdirSync(join(pasta, 'brand'), { recursive: true });
  mkdirSync(join(pasta, 'fontes'), { recursive: true });
  const t = padrao();
  t.id = 'teste';
  mexe(t);
  writeFileSync(join(pasta, 'tema.json'), JSON.stringify(t));
  writeFileSync(join(pasta, 'brand', 'logo.png'), 'png');
  writeFileSync(join(pasta, 'fontes', 'f.woff2'), 'fonte');
  writeFileSync(join(pasta, 'segredo.txt'), 'segredo');
  if (ativo !== null) writeFileSync(join(tmp.dir, 'tema-ativo'), `${ativo}\n`);
  return { hostDir: tmp.dir, pasta, pastas: { hostDir: tmp.dir, padraoDir: PADRAO_DIR } };
}

describe('carga do tema ativo', () => {
  it('sem tema-ativo usa o padrão do repositório, sem aviso', () => {
    const h = host(() => {}, null);
    const r = carregarTema(h.pastas);
    expect(r).toMatchObject({ id: 'padrao', base: '/temas/padrao/' });
    expect(r.aviso).toBeUndefined();
  });

  it('usa o tema escolhido em tema-ativo', () => {
    const h = host((t) => (t.textos.produto = 'Outro'));
    const r = carregarTema(h.pastas);
    expect(r).toMatchObject({ id: 'teste', base: '/temas/teste/' });
    expect(r.tema.textos.produto).toBe('Outro');
    expect(r.aviso).toBeUndefined();
  });

  it('tema que quebra o schema cai no padrão e avisa', () => {
    const r = carregarTema(host((t) => (t.paleta.ui.texto = 'red')).pastas);
    expect(r.id).toBe('padrao');
    expect(r.aviso).toMatch(/teste.*ignorado/);
  });

  it('versão desconhecida cai no padrão e avisa', () => {
    const r = carregarTema(host((t) => ((t as { versao: number }).versao = 2)).pastas);
    expect(r.id).toBe('padrao');
    expect(r.aviso).toBeDefined();
  });

  it('contraste abaixo do mínimo cai no padrão e avisa', () => {
    const r = carregarTema(host((t) => (t.paleta.ui.texto = '#2a2f3a')).pastas);
    expect(r.id).toBe('padrao');
    expect(r.aviso).toMatch(/contraste/);
  });

  it('tema sem os pares de contraste do padrão cai no padrão', () => {
    const r = carregarTema(host((t) => (t.contraste = t.contraste.slice(0, 3))).pastas);
    expect(r.id).toBe('padrao');
    expect(r.aviso).toMatch(/falta o par/);
  });

  it('id dentro do tema.json diferente da pasta cai no padrão', () => {
    const r = carregarTema(host((t) => (t.id = 'outro')).pastas);
    expect(r.id).toBe('padrao');
    expect(r.aviso).toBeDefined();
  });

  it('tema-ativo apontando para pasta inexistente ou com nome inválido cai no padrão e avisa', () => {
    expect(carregarTema(host(() => {}, 'nao-existe').pastas).aviso).toMatch(/ausente/);
    expect(carregarTema(host(() => {}, '../etc').pastas).aviso).toMatch(/não é válido/);
  });

  it('JSON quebrado cai no padrão e avisa', () => {
    const h = host();
    writeFileSync(join(h.pasta, 'tema.json'), '{ quebrado');
    expect(carregarTema(h.pastas).aviso).toBeDefined();
  });
});

describe('arquivos do tema', () => {
  const ativo = (h: ReturnType<typeof host>) => carregarTema(h.pastas);

  it('serve PNG e a fonte declarada, nada mais', () => {
    const h = host((t) => (t.tipografia.arquivo = 'fontes/f.woff2'));
    const a = ativo(h);
    expect(arquivoDoTema(h.pastas, a, 'teste', 'brand/logo.png')?.tipo).toBe('image/png');
    expect(arquivoDoTema(h.pastas, a, 'teste', 'fontes/f.woff2')?.tipo).toBe('font/woff2');
    expect(arquivoDoTema(h.pastas, a, 'teste', 'segredo.txt')).toBeUndefined();
    expect(arquivoDoTema(h.pastas, a, 'teste', 'tema.json')).toBeUndefined();
  });

  it('só atende o tema ativo', () => {
    const h = host();
    expect(arquivoDoTema(h.pastas, ativo(h), 'padrao', 'brand/logo-mark.png')).toBeUndefined();
  });

  it('recusa .. e caminho absoluto', () => {
    const h = host();
    const a = ativo(h);
    expect(arquivoDoTema(h.pastas, a, 'teste', '../teste/brand/logo.png')).toBeUndefined();
    expect(arquivoDoTema(h.pastas, a, 'teste', '/etc/hosts.png')).toBeUndefined();
  });

  it('PNG que é link para fora da pasta do tema não sai', () => {
    const h = host();
    const fora = tempDir();
    limpezas.push(fora.cleanup);
    writeFileSync(join(fora.dir, 'fora.png'), 'png');
    symlinkSync(join(fora.dir, 'fora.png'), join(h.pasta, 'brand', 'link.png'));
    expect(arquivoDoTema(h.pastas, ativo(h), 'teste', 'brand/link.png')).toBeUndefined();
  });
});

describe('rotas do tema', () => {
  async function servir(h: ReturnType<typeof host>) {
    const a = carregarTema(h.pastas);
    const handler = createTemaHandler(h.pastas, a, (res, status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    });
    const server = http.createServer((req, res) => {
      if (!handler(req, res, new URL(req.url ?? '/', 'http://x'))) {
        res.writeHead(418);
        res.end();
      }
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    limpezas.push(() => server.close());
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it('GET /api/tema devolve o tema ativo e o aviso', async () => {
    const base = await servir(host((t) => (t.paleta.ui.texto = 'red')));
    const corpo = (await (await fetch(`${base}/api/tema`)).json()) as { aviso?: string; tema: Tema };
    expect(corpo).toMatchObject({ id: 'padrao', base: '/temas/padrao/' });
    expect(corpo.aviso).toBeDefined();
    expect(corpo.tema.paleta.ui.texto).toBe('#e8ecf5');
  });

  it('/temas/<id>/<arquivo> entrega PNG com tipo certo e 404 para o resto', async () => {
    const base = await servir(host());
    const png = await fetch(`${base}/temas/teste/brand/logo.png`);
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect((await fetch(`${base}/temas/teste/segredo.txt`)).status).toBe(404);
    expect((await fetch(`${base}/temas/teste/%2e%2e/temas/teste/tema.json`)).status).toBe(404);
    expect((await fetch(`${base}/temas/teste/brand/logo.png`, { method: 'POST' })).status).toBe(405);
  });

  it('deixa passar o que não é tema', async () => {
    const base = await servir(host());
    expect((await fetch(`${base}/api/health`)).status).toBe(418);
  });
});

describe('pasta da ponte', () => {
  it('é ~/.expediente/host no host, /host no container e EXPEDIENTE_PONTE_DIR vence', () => {
    expect(loadConfig({ HOME: '/h' }, [], false).hostDir).toBe('/h/.expediente/host');
    expect(loadConfig({ HOME: '/h' }, [], true).hostDir).toBe('/host');
    expect(loadConfig({ HOME: '/h', EXPEDIENTE_PONTE_DIR: '/x/ponte' }, [], false).hostDir).toBe('/x/ponte');
  });
});
