import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tema } from '../../shared/tema/validar';
import { createTemaHandler } from '../http/tema';
import { Hub } from '../http/sse';
import { setQuiet } from '../log';
import { NameStore } from '../model/names';
import { Office } from '../model/office';
import { TemaAtivo, vigiarTema } from '../tema/ativo';
import type { TemaCarregado } from '../tema/carregar';
import { tempDir } from './fixtures';

setQuiet(true);

const PADRAO_DIR = resolve(__dirname, '../../client/public/temas/padrao');
const limpezas: (() => void)[] = [];
afterEach(() => limpezas.splice(0).forEach((f) => f()));

function gravarTema(hostDir: string, id: string, produto = 'Produto'): string {
  const pasta = join(hostDir, 'temas', id);
  mkdirSync(join(pasta, 'brand'), { recursive: true });
  const t: Tema = JSON.parse(readFileSync(join(PADRAO_DIR, 'tema.json'), 'utf8'));
  t.id = id;
  t.textos.produto = produto;
  writeFileSync(join(pasta, 'tema.json'), JSON.stringify(t));
  writeFileSync(join(pasta, 'brand', 'logo-mark.png'), `logo de ${id}`);
  return pasta;
}

/** Host com os temas "um" e "dois" e um relógio que só anda quando o teste manda. */
function ambiente(ativo: string | null = 'um') {
  const tmp = tempDir();
  limpezas.push(tmp.cleanup);
  gravarTema(tmp.dir, 'um');
  gravarTema(tmp.dir, 'dois');
  const escrever = (nome: string) => writeFileSync(join(tmp.dir, 'tema-ativo'), `${nome}\n`);
  if (ativo !== null) escrever(ativo);
  const relogio = { agora: 1_000_000 };
  const pastas = { hostDir: tmp.dir, padraoDir: PADRAO_DIR };
  const temas = new TemaAtivo(pastas, () => relogio.agora, 1_000);
  return { hostDir: tmp.dir, pastas, temas, escrever, avancar: (ms: number) => (relogio.agora += ms) };
}

describe('troca do tema ativo sem reiniciar', () => {
  it('gravar tema-ativo troca o tema servido depois do intervalo, e avisa quem ouve uma vez', () => {
    const a = ambiente('um');
    const avisos: TemaCarregado[] = [];
    a.temas.aoTrocar((t) => avisos.push(t));
    expect(a.temas.get().id).toBe('um');

    a.escrever('dois');
    expect(a.temas.get().id, 'antes do intervalo mínimo ainda vale o anterior').toBe('um');
    a.avancar(1_000);
    expect(a.temas.get()).toMatchObject({ id: 'dois', base: '/temas/dois/' });
    expect(a.temas.get().aviso).toBeUndefined();
    a.avancar(5_000);
    a.temas.conferir();
    expect(avisos.map((t) => t.id)).toEqual(['dois']);
  });

  it('id inválido em tema-ativo cai no padrão com aviso; um id bom depois volta ao tema', () => {
    const a = ambiente('um');
    a.escrever('../fora');
    a.avancar(1_000);
    expect(a.temas.get()).toMatchObject({ id: 'padrao' });
    expect(a.temas.get().aviso).toMatch(/não é válido/);
    a.escrever('um');
    a.avancar(1_000);
    expect(a.temas.get()).toMatchObject({ id: 'um' });
    expect(a.temas.get().aviso).toBeUndefined();
  });

  it('tema ativo que passa a ser inválido cai no padrão com aviso', () => {
    const a = ambiente('um');
    writeFileSync(join(a.hostDir, 'temas', 'um', 'tema.json'), '{ quebrado');
    a.avancar(1_000);
    expect(a.temas.get().id).toBe('padrao');
    expect(a.temas.get().aviso).toMatch(/ilegível/);
  });

  it('tema.json reescrito do tema ativo vale sem trocar o id', () => {
    const a = ambiente('um');
    expect(a.temas.get().tema.textos.produto).toBe('Produto');
    gravarTema(a.hostDir, 'um', 'Produto com nome maior');
    a.avancar(1_000);
    expect(a.temas.get().tema.textos.produto).toBe('Produto com nome maior');
  });

  it('voltar ao padrão: tema-ativo com "padrao" ou removido', () => {
    const a = ambiente('um');
    a.escrever('padrao');
    a.avancar(1_000);
    expect(a.temas.get()).toMatchObject({ id: 'padrao', base: '/temas/padrao/' });
    expect(a.temas.get().aviso).toBeUndefined();
    a.escrever('dois');
    a.avancar(1_000);
    expect(a.temas.get().id).toBe('dois');
    rmSync(join(a.hostDir, 'tema-ativo'));
    a.avancar(1_000);
    expect(a.temas.get().id).toBe('padrao');
  });

  it('sem mudança no disco ninguém é avisado', () => {
    const a = ambiente('um');
    let chamadas = 0;
    a.temas.aoTrocar(() => chamadas++);
    for (let i = 0; i < 5; i++) {
      a.avancar(1_000);
      a.temas.conferir();
    }
    expect(chamadas).toBe(0);
  });

  it('entre duas conferências o disco não é relido', () => {
    const a = ambiente('um');
    a.escrever('dois');
    a.avancar(999);
    a.temas.conferir();
    expect(a.temas.get().id).toBe('um');
  });

  it('tema-ativo que passa a ser link simbólico para um tema de fora cai no padrão', () => {
    const a = ambiente('um');
    const fora = tempDir();
    limpezas.push(fora.cleanup);
    gravarTema(fora.dir, 'fora');
    rmSync(join(a.hostDir, 'temas', 'dois'), { recursive: true });
    symlinkSync(join(fora.dir, 'temas', 'fora'), join(a.hostDir, 'temas', 'dois'));
    a.escrever('dois');
    a.avancar(1_000);
    expect(a.temas.get().id).toBe('padrao');
    expect(a.temas.get().aviso).toMatch(/link simbólico/);
  });

  it('GET /api/tema e os arquivos acompanham a troca', async () => {
    const a = ambiente('um');
    const handler = createTemaHandler(a.pastas, () => a.temas.get(), (res, status, corpo) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(corpo));
    });
    const server = http.createServer((req, res) => void handler(req, res, new URL(req.url ?? '/', 'http://x')));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    limpezas.push(() => server.close());
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const tema = async () => (await (await fetch(`${base}/api/tema`)).json()) as { id: string; aviso?: string; chave: string };

    expect(await tema()).toMatchObject({ id: 'um', chave: 'um|' });
    a.escrever('dois');
    a.avancar(1_000);
    expect(await tema()).toMatchObject({ id: 'dois', chave: 'dois|' });
    expect(await (await fetch(`${base}/temas/dois/brand/logo-mark.png`)).text()).toBe('logo de dois');
    a.escrever('nome/invalido');
    a.avancar(1_000);
    const caiu = await tema();
    expect(caiu.id).toBe('padrao');
    expect(caiu.aviso).toMatch(/não é válido/);
    a.escrever('padrao');
    a.avancar(1_000);
    expect(await tema()).toMatchObject({ id: 'padrao', chave: 'padrao|' });
  });
});

describe('aviso às páginas abertas', () => {
  function hub() {
    const office = new Office({ names: new NameStore(null), version: '9.9.9', startedAt: Date.now(), accounts: () => [], sources: () => [], accountName: () => undefined });
    const h = new Hub(office, { throttleMs: 10 });
    h.start();
    limpezas.push(() => h.stop());
    return h;
  }

  async function ouvir(h: Hub) {
    const server = http.createServer((req, res) => h.attach(req, res));
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
    limpezas.push(() => server.closeAllConnections());
    limpezas.push(() => server.close());
    const ctrl = new AbortController();
    limpezas.push(() => ctrl.abort());
    const res = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/stream`, { signal: ctrl.signal });
    const leitor = res.body!.getReader();
    const dec = new TextDecoder();
    let texto = '';
    return {
      ate: async (re: RegExp) => {
        while (!re.test(texto)) texto += dec.decode((await leitor.read()).value, { stream: true });
        return texto;
      },
    };
  }

  it('gravar tema-ativo chega à página aberta como o evento "tema" com a chave nova', async () => {
    const a = ambiente('um');
    const h = hub();
    const parar = vigiarTema(a.temas, h, 20);
    limpezas.push(parar);
    const pagina = await ouvir(h);
    expect(await pagina.ate(/event: tema\ndata: \{"chave":"um\|"\}/)).toContain('event: snapshot');

    a.escrever('dois');
    a.avancar(1_000);
    expect(await pagina.ate(/event: tema\ndata: \{"chave":"dois\|"\}/)).toBeTruthy();

    a.escrever('...');
    a.avancar(1_000);
    expect(await pagina.ate(/event: tema\ndata: \{"chave":"padrao\|Tema ativo ignorado/)).toBeTruthy();
  });

  it('quem conecta depois recebe a chave de agora, diferente da que uma aba antiga carregou', async () => {
    const a = ambiente('um');
    const h = hub();
    const parar = vigiarTema(a.temas, h, 20);
    limpezas.push(parar);
    a.escrever('dois');
    a.avancar(1_000);
    await new Promise((ok) => setTimeout(ok, 80));
    const tardia = await ouvir(h);
    const texto = await tardia.ate(/event: tema/);
    expect(texto).toContain('"chave":"dois|"');
    expect(texto).not.toContain('"chave":"um|"');
  });

  it('a vigia avisa a chave da partida e, parada, solta o intervalo', () => {
    vi.useFakeTimers();
    try {
      const a = ambiente('um');
      const avisadas: string[] = [];
      const parar = vigiarTema(a.temas, { avisarTema: (c) => avisadas.push(c) }, 20);
      expect(avisadas).toEqual(['um|']);
      expect(vi.getTimerCount()).toBe(1);
      parar();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('parar a vigia: nada mais é avisado', async () => {
    const a = ambiente('um');
    const h = hub();
    const parar = vigiarTema(a.temas, h, 20);
    parar();
    a.escrever('dois');
    a.avancar(1_000);
    await new Promise((ok) => setTimeout(ok, 80));
    const pagina = await ouvir(h);
    expect(await pagina.ate(/event: tema/)).toContain('"chave":"um|"');
  });
});
