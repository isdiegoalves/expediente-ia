import { mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Tema } from '../../shared/tema/validar';
import { loadConfig } from '../config';
import { createTemaHandler } from '../http/tema';
import { arquivoDoTema, carregarTema, chaveDoTema } from '../tema/carregar';
import { tempDir } from './fixtures';

const PADRAO_DIR = resolve(__dirname, '../../client/public/temas/padrao');
const padrao = (): Tema => JSON.parse(readFileSync(join(PADRAO_DIR, 'tema.json'), 'utf8'));

const limpezas: (() => void)[] = [];
afterEach(() => limpezas.splice(0).forEach((f) => f()));

const QUADRO = { id: 'quadro-um', tipo: 'painting' as const, arquivo: 'art/quadro-um.png', tiles: 2, moldura: { arquivo: 'art/framed/quadro-um.png', largura: 32, altura: 22 } };
const DECLARADOS = ['brand/logo-mark.png', 'brand/signage.png', QUADRO.arquivo, QUADRO.moldura.arquivo, 'fontes/f.woff2'];

/** Grava a pasta de um tema com os arquivos que o tema.json declara, mais três que ele não declara. */
function gravarTema(raiz: string, id: string, mexe: (t: Tema) => void = () => {}): string {
  const pasta = join(raiz, 'temas', id);
  for (const d of ['brand', 'art/framed', 'fontes', 'referencias']) mkdirSync(join(pasta, d), { recursive: true });
  const t = padrao();
  t.id = id;
  t.decoracao.quadros = [QUADRO];
  t.tipografia.arquivo = 'fontes/f.woff2';
  mexe(t);
  writeFileSync(join(pasta, 'tema.json'), JSON.stringify(t));
  for (const d of DECLARADOS) writeFileSync(join(pasta, d), `conteudo de ${id}/${d}`);
  writeFileSync(join(pasta, 'referencias', 'qualquer.png'), 'referencia da marca');
  writeFileSync(join(pasta, 'art', 'sem-declarar.png'), 'nao declarado');
  writeFileSync(join(pasta, 'segredo.txt'), 'segredo');
  return pasta;
}

/** Host com o tema "teste" (e `tema-ativo` apontando para ele, a menos que `ativo` seja outro texto). */
function host(mexe: (t: Tema) => void = () => {}, ativo: string | null = 'teste') {
  const tmp = tempDir();
  limpezas.push(tmp.cleanup);
  const pasta = gravarTema(tmp.dir, 'teste', mexe);
  if (ativo !== null) writeFileSync(join(tmp.dir, 'tema-ativo'), `${ativo}\n`);
  return { hostDir: tmp.dir, pasta, pastas: { hostDir: tmp.dir, padraoDir: PADRAO_DIR }, criar: (id: string, m?: (t: Tema) => void) => gravarTema(tmp.dir, id, m) };
}

type Host = ReturnType<typeof host>;

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

  it('tema-ativo que não é arquivo comum pequeno cai no padrão e avisa', () => {
    const h = host(() => {}, null);
    mkdirSync(join(h.hostDir, 'tema-ativo'));
    expect(carregarTema(h.pastas).aviso).toMatch(/não é válido/);
    const grande = host(() => {}, 'a'.repeat(1024));
    expect(carregarTema(grande.pastas).aviso).toMatch(/não é válido/);
  });

  it('JSON quebrado cai no padrão e avisa', () => {
    const h = host();
    writeFileSync(join(h.pasta, 'tema.json'), '{ quebrado');
    expect(carregarTema(h.pastas).aviso).toBeDefined();
  });

  it('tema.json que é link simbólico cai no padrão e avisa', () => {
    const h = host();
    const fora = tempDir();
    limpezas.push(fora.cleanup);
    writeFileSync(join(fora.dir, 'tema.json'), readFileSync(join(h.pasta, 'tema.json')));
    rmSync(join(h.pasta, 'tema.json'));
    symlinkSync(join(fora.dir, 'tema.json'), join(h.pasta, 'tema.json'));
    const r = carregarTema(h.pastas);
    expect(r.id).toBe('padrao');
    expect(r.aviso).toMatch(/ilegível/);
  });

  it('pasta do tema que é link simbólico para fora cai no padrão e avisa', () => {
    const h = host(() => {}, 'fora');
    const fora = tempDir();
    limpezas.push(fora.cleanup);
    const real = gravarTema(fora.dir, 'fora');
    symlinkSync(real, join(h.hostDir, 'temas', 'fora'));
    const r = carregarTema(h.pastas);
    expect(r.id).toBe('padrao');
    expect(r.aviso).toMatch(/link simbólico/);
  });
});

describe('arquivos do tema', () => {
  const ativo = (h: Host) => carregarTema(h.pastas);

  it('serve só o que o tema.json declara: a marca, o quadro com a moldura e a fonte', () => {
    const h = host();
    const a = ativo(h);
    for (const d of DECLARADOS) expect(arquivoDoTema(h.pastas, a, 'teste', d)?.caminho, d).toMatch(new RegExp(`${d}$`));
    expect(arquivoDoTema(h.pastas, a, 'teste', 'brand/logo-mark.png')?.tipo).toBe('image/png');
    expect(arquivoDoTema(h.pastas, a, 'teste', 'fontes/f.woff2')?.tipo).toBe('font/woff2');
  });

  it('PNG que o tema não declara, referência da marca e tema.json não saem', () => {
    const h = host();
    const a = ativo(h);
    for (const rel of ['referencias/qualquer.png', 'art/sem-declarar.png', 'segredo.txt', 'tema.json']) expect(arquivoDoTema(h.pastas, a, 'teste', rel), rel).toBeUndefined();
  });

  it('serve o candidato válido, e só os arquivos dele', () => {
    const h = host();
    h.criar('cand');
    const a = ativo(h);
    expect(arquivoDoTema(h.pastas, a, 'cand', 'brand/signage.png')?.caminho).toMatch(/cand\/brand\/signage\.png$/);
    expect(arquivoDoTema(h.pastas, a, 'cand', 'referencias/qualquer.png')).toBeUndefined();
    expect(arquivoDoTema(h.pastas, a, 'cand', 'tema.json')).toBeUndefined();
  });

  it('candidato reprovado na conferência não serve nada', () => {
    const h = host();
    h.criar('ruim', (t) => (t.paleta.ui.texto = '#2a2f3a'));
    expect(arquivoDoTema(h.pastas, ativo(h), 'ruim', 'brand/logo-mark.png')).toBeUndefined();
  });

  it('recusa .. e caminho absoluto', () => {
    const h = host();
    const a = ativo(h);
    expect(arquivoDoTema(h.pastas, a, 'teste', '../teste/brand/logo-mark.png')).toBeUndefined();
    expect(arquivoDoTema(h.pastas, a, 'teste', '/etc/hosts.png')).toBeUndefined();
    expect(arquivoDoTema(h.pastas, a, '..', 'teste/brand/logo-mark.png')).toBeUndefined();
  });

  it('arquivo declarado que é link simbólico para fora não sai', () => {
    const h = host();
    const fora = tempDir();
    limpezas.push(fora.cleanup);
    writeFileSync(join(fora.dir, 'fora.png'), 'png de fora');
    rmSync(join(h.pasta, 'brand', 'signage.png'));
    symlinkSync(join(fora.dir, 'fora.png'), join(h.pasta, 'brand', 'signage.png'));
    expect(arquivoDoTema(h.pastas, ativo(h), 'teste', 'brand/signage.png')).toBeUndefined();
  });

  it('arquivo declarado que é link para outro arquivo da pasta (referencias/) não sai', () => {
    const h = host();
    rmSync(join(h.pasta, 'brand', 'signage.png'));
    symlinkSync(join(h.pasta, 'referencias', 'qualquer.png'), join(h.pasta, 'brand', 'signage.png'));
    expect(arquivoDoTema(h.pastas, ativo(h), 'teste', 'brand/signage.png')).toBeUndefined();
    expect(arquivoDoTema(h.pastas, ativo(h), 'teste', 'brand/logo-mark.png')).toBeDefined();
  });

  it('declarado dentro de uma pasta que é link simbólico para fora não sai', () => {
    const h = host();
    const fora = tempDir();
    limpezas.push(fora.cleanup);
    writeFileSync(join(fora.dir, 'quadro-um.png'), 'png de fora');
    rmSync(join(h.pasta, 'art', 'framed'), { recursive: true });
    symlinkSync(fora.dir, join(h.pasta, 'art', 'framed'));
    expect(arquivoDoTema(h.pastas, ativo(h), 'teste', 'art/framed/quadro-um.png')).toBeUndefined();
    expect(arquivoDoTema(h.pastas, ativo(h), 'teste', 'art/quadro-um.png')).toBeDefined();
  });

  it('candidato cuja pasta é link simbólico para fora não serve nada', () => {
    const h = host();
    const fora = tempDir();
    limpezas.push(fora.cleanup);
    symlinkSync(gravarTema(fora.dir, 'fora'), join(h.hostDir, 'temas', 'fora'));
    expect(arquivoDoTema(h.pastas, ativo(h), 'fora', 'brand/logo-mark.png')).toBeUndefined();
  });
});

describe('rotas do tema', () => {
  async function servir(h: Host) {
    const handler = createTemaHandler(h.pastas, () => carregarTema(h.pastas), (res, status, body) => {
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
    return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, porta: (server.address() as AddressInfo).port };
  }

  /** GET com o caminho exatamente como escrito (o fetch normaliza `..`). */
  const cru = (porta: number, caminho: string) =>
    new Promise<{ status: number; corpo: string }>((ok, falha) => {
      http
        .get({ host: '127.0.0.1', port: porta, path: caminho }, (res) => {
          let corpo = '';
          res.on('data', (c) => (corpo += c));
          res.on('end', () => ok({ status: res.statusCode ?? 0, corpo }));
        })
        .on('error', falha);
    });

  const api = async (base: string, consulta = '') => (await (await fetch(`${base}/api/tema${consulta}`)).json()) as { id: string; base: string; aviso?: string; previa?: boolean; chave: string; tema: Tema };

  it('GET /api/tema devolve o tema ativo e o aviso', async () => {
    const { base } = await servir(host((t) => (t.paleta.ui.texto = 'red')));
    const corpo = await api(base);
    expect(corpo).toMatchObject({ id: 'padrao', base: '/temas/padrao/' });
    expect(corpo.aviso).toBeDefined();
    expect(corpo.tema.paleta.ui.texto).toBe('#e8ecf5');
    expect(corpo.previa).toBeUndefined();
  });

  it('/temas/<id>/<arquivo> entrega o declarado com o tipo certo e 404 para o resto', async () => {
    const { base } = await servir(host());
    const png = await fetch(`${base}/temas/teste/brand/logo-mark.png`);
    expect(png.status).toBe(200);
    expect(png.headers.get('content-type')).toBe('image/png');
    expect(await png.text()).toBe('conteudo de teste/brand/logo-mark.png');
    expect((await fetch(`${base}/temas/teste/segredo.txt`)).status).toBe(404);
    expect((await fetch(`${base}/temas/teste/brand/logo-mark.png`, { method: 'POST' })).status).toBe(405);
  });

  it('deixa passar o que não é tema', async () => {
    const { base } = await servir(host());
    expect((await fetch(`${base}/api/health`)).status).toBe(418);
  });

  describe('prévia', () => {
    it('?previa=<id> devolve o candidato válido como prévia e não muda o ativo nem grava nada', async () => {
      const h = host();
      h.criar('cand', (t) => (t.textos.produto = 'Candidato'));
      const antes = JSON.stringify(readdirSync(h.hostDir, { recursive: true }).sort()) + readFileSync(join(h.hostDir, 'tema-ativo'), 'utf8');
      const { base } = await servir(h);
      const previa = await api(base, '?previa=cand');
      expect(previa).toMatchObject({ id: 'cand', base: '/temas/cand/', previa: true });
      expect(previa.tema.textos.produto).toBe('Candidato');
      expect(previa.aviso).toBeUndefined();
      expect(previa.chave).toBe(chaveDoTema(carregarTema(h.pastas)));
      const ativo = await api(base);
      expect(ativo).toMatchObject({ id: 'teste', base: '/temas/teste/' });
      expect(ativo.previa).toBeUndefined();
      expect(JSON.stringify(readdirSync(h.hostDir, { recursive: true }).sort()) + readFileSync(join(h.hostDir, 'tema-ativo'), 'utf8')).toBe(antes);
    });

    it('a prévia do próprio tema ativo é o tema ativo, sem marca de prévia', async () => {
      const { base } = await servir(host());
      const r = await api(base, '?previa=teste');
      expect(r.id).toBe('teste');
      expect(r.previa).toBeUndefined();
      expect(r.aviso).toBeUndefined();
    });

    it.each([
      ['candidato reprovado no contraste', 'ruim', /contraste/],
      ['id inexistente', 'nao-existe', /ausente/],
      ['id com ..', '..%2fteste', /não é válido/],
      ['id com maiúscula', 'Cand', /não é válido/],
      ['id vazio', '', /não é válido/],
      ['id grande demais', 'a'.repeat(41), /não é válido/],
    ])('%s: o ativo fica e vem o aviso', async (_nome, pedido, aviso) => {
      const h = host();
      h.criar('ruim', (t) => (t.paleta.ui.texto = '#2a2f3a'));
      const { base } = await servir(h);
      const r = await api(base, `?previa=${pedido}`);
      expect(r).toMatchObject({ id: 'teste', base: '/temas/teste/' });
      expect(r.previa).toBeUndefined();
      expect(r.aviso).toMatch(/Prévia recusada/);
      expect(r.aviso).toMatch(aviso);
    });

    it('id que é link simbólico para fora: o ativo fica e vem o aviso', async () => {
      const h = host();
      const fora = tempDir();
      limpezas.push(fora.cleanup);
      symlinkSync(gravarTema(fora.dir, 'fora'), join(h.hostDir, 'temas', 'fora'));
      const { base } = await servir(h);
      const r = await api(base, '?previa=fora');
      expect(r.id).toBe('teste');
      expect(r.previa).toBeUndefined();
      expect(r.aviso).toMatch(/link simbólico/);
    });

    it('o texto do pedido não volta no aviso quando não é um id', async () => {
      const { base } = await servir(host());
      const r = await api(base, `?previa=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
      expect(r.aviso).toMatch(/Prévia recusada/);
      expect(r.aviso).not.toMatch(/img|onerror/);
    });

    it('junta o aviso do tema ativo ao da prévia recusada', async () => {
      const { base } = await servir(host((t) => (t.paleta.ui.texto = 'red')));
      const r = await api(base, '?previa=nao-existe');
      expect(r.id).toBe('padrao');
      expect(r.aviso).toMatch(/Prévia recusada.*teste.*ignorado/);
    });
  });

  describe('arquivos de candidatos', () => {
    it('serve o declarado do candidato válido', async () => {
      const h = host();
      h.criar('cand');
      const { base } = await servir(h);
      const r = await fetch(`${base}/temas/cand/art/framed/quadro-um.png`);
      expect(r.status).toBe(200);
      expect(await r.text()).toBe('conteudo de cand/art/framed/quadro-um.png');
    });

    it('referencias/, arquivo não declarado, tema.json e candidato reprovado levam 404', async () => {
      const h = host();
      h.criar('cand');
      h.criar('ruim', (t) => (t.paleta.ui.texto = '#2a2f3a'));
      const { base } = await servir(h);
      for (const caminho of ['cand/referencias/qualquer.png', 'cand/art/sem-declarar.png', 'cand/tema.json', 'cand/segredo.txt', 'teste/referencias/qualquer.png', 'ruim/brand/logo-mark.png', 'inexistente/brand/logo-mark.png', 'padrao/segredo.png']) {
        expect((await fetch(`${base}/temas/${caminho}`)).status, caminho).toBe(404);
      }
    });

    it('.. literal, escape codificado e dupla codificação levam 404, sem vazar o outro tema', async () => {
      const h = host();
      h.criar('cand');
      const { porta } = await servir(h);
      for (const caminho of [
        '/temas/cand/../teste/tema.json',
        '/temas/cand/%2e%2e/teste/tema.json',
        '/temas/cand/..%2fteste%2ftema.json',
        '/temas/cand/%252e%252e/teste/tema.json',
        '/temas/%2e%2e%2fcand/brand/logo-mark.png',
        '/temas/cand/brand/..%2f..%2fcand%2freferencias%2fqualquer.png',
        '/temas/cand/%2e%2e%2f%2e%2e%2fcand%2freferencias%2fqualquer.png',
        '/temas/cand/brand/logo-mark.png%00.png',
      ]) {
        const r = await cru(porta, caminho);
        expect(r.status, caminho).toBe(404);
        expect(r.corpo, caminho).not.toMatch(/versao|referencia da marca|segredo/);
      }
    });

    it('declarado que é link simbólico para fora leva 404', async () => {
      const h = host();
      const cand = h.criar('cand');
      const fora = tempDir();
      limpezas.push(fora.cleanup);
      writeFileSync(join(fora.dir, 'fora.png'), 'png de fora');
      rmSync(join(cand, 'brand', 'logo-mark.png'));
      symlinkSync(join(fora.dir, 'fora.png'), join(cand, 'brand', 'logo-mark.png'));
      const { base } = await servir(h);
      expect((await fetch(`${base}/temas/cand/brand/logo-mark.png`)).status).toBe(404);
      expect((await fetch(`${base}/temas/cand/brand/signage.png`)).status).toBe(200);
    });

    it('candidato cuja pasta é link simbólico para fora leva 404', async () => {
      const h = host();
      const fora = tempDir();
      limpezas.push(fora.cleanup);
      symlinkSync(gravarTema(fora.dir, 'fora'), join(h.hostDir, 'temas', 'fora'));
      const { base } = await servir(h);
      expect((await fetch(`${base}/temas/fora/brand/logo-mark.png`)).status).toBe(404);
    });
  });
});

describe('pasta da ponte', () => {
  it('é ~/.expediente/host no host, /host no container e EXPEDIENTE_PONTE_DIR vence', () => {
    expect(loadConfig({ HOME: '/h' }, [], false).hostDir).toBe('/h/.expediente/host');
    expect(loadConfig({ HOME: '/h' }, [], true).hostDir).toBe('/host');
    expect(loadConfig({ HOME: '/h', EXPEDIENTE_PONTE_DIR: '/x/ponte' }, [], false).hostDir).toBe('/x/ponte');
  });
});
