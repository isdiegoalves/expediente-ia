// Uma prova por trava dos scripts do tema: cada teste cai se a trava correspondente sair do código.
// Marca fictícia; HOME fictício em toda execução; nenhum byte pode aparecer fora da pasta do tema.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { destinoGravavel, gravarArquivoComum } from './confinar.mjs';
import { gravarPng, lerPng } from './png.mjs';
import { reescreverSvg } from './svg.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'tema.mjs');
const MB = 1024 * 1024;
let raiz;
let home;
let extraEnv = {};

const novoHome = () => {
  home = join(raiz, `h-${randomBytes(4).toString('hex')}`);
  mkdirSync(home);
  extraEnv = {};
};
const pastaDoTema = (id = 'aurora-ficticia') => join(home, '.expediente/host/temas', id);

function cli(...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH, HOME: home, ...extraEnv }, encoding: 'utf8' });
  return { code: r.status, saida: r.stdout, erro: r.stderr };
}

const logoPng = () => {
  const l = 16;
  const rgba = new Uint8Array(l * l * 4);
  for (let i = 0; i < l * l; i++) rgba.set(i % 3 ? [200, 40, 90, 255] : [255, 255, 255, 255], i * 4);
  return gravarPng({ largura: l, altura: l, rgba });
};
const marcaBase = (extra = {}) => ({
  id: 'aurora-ficticia',
  nome: 'Aurora Ficticia',
  cores: { primaria: '#c8285a', destaque: '#2a9d8f' },
  fontes: [{ tipo: 'manual', referencia: 'descrição dada pelo dono' }],
  ...extra,
});
const escreverMarca = (obj, nome = 'marca.json') => {
  writeFileSync(join(raiz, nome), typeof obj === 'string' ? obj : JSON.stringify(obj));
  return join(raiz, nome);
};
const SVG_OK = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#c8285a"/><circle cx="32" cy="32" r="16" fill="#ffffff"/></svg>';
const svgOk = (nome = 'ok.svg') => {
  writeFileSync(join(raiz, nome), SVG_OK);
  return join(raiz, nome);
};

/** `sips` falso: marca que foi chamado e entrega o PNG dado. */
function sipsFalso(png) {
  const bin = join(raiz, `bin-${randomBytes(4).toString('hex')}`);
  mkdirSync(bin);
  const pronto = join(bin, 'pronto.png');
  const chamado = join(bin, 'chamado');
  writeFileSync(pronto, png);
  writeFileSync(join(bin, 'sips'), `#!/bin/sh\ntouch "${chamado}"\nfor a in "$@"; do prev="$a"; done\ncp "${pronto}" "$prev"\n`);
  chmodSync(join(bin, 'sips'), 0o755);
  extraEnv = { PATH: `${bin}:${process.env.PATH}` };
  return { chamado: () => existsSync(chamado) };
}

/** Pasta de fora com um arquivo sentinela e uma foto do conteúdo, para provar que nada mudou. */
function fora(nome = 'fora') {
  const dir = join(raiz, `${nome}-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'sentinela.txt'), 'conteudo do dono');
  return { dir, intacto: () => assert.deepEqual([readdirSync(dir), readFileSync(join(dir, 'sentinela.txt'), 'utf8')], [['sentinela.txt'], 'conteudo do dono']) };
}

before(() => {
  raiz = mkdtempSync(join(tmpdir(), 'travas-'));
});
after(() => rmSync(raiz, { recursive: true, force: true }));

describe('gravação confinada', () => {
  test('tema.json que é link simbólico não é reescrito pelo contraste --ajustar', () => {
    novoHome();
    const f = fora();
    const alvo = join(f.dir, 'sentinela.txt');
    assert.equal(cli('montar', escreverMarca(marcaBase({ cores: { primaria: '#c8285a', destaque: '#2a9d8f', fundo: '#1b1230', texto: '#c9c0d9' } }))).code, 0);
    const caminho = join(pastaDoTema(), 'tema.json');
    writeFileSync(alvo, readFileSync(caminho));
    rmSync(caminho);
    symlinkSync(alvo, caminho);
    const antes = readFileSync(alvo, 'utf8');
    const r = cli('contraste', 'aurora-ficticia', '--ajustar');
    assert.equal(r.code, 1);
    assert.match(r.erro, /link simbólico/);
    assert.equal(readFileSync(alvo, 'utf8'), antes);
  });

  test('.expediente ou host como link para fora: preparar, montar e rasterizar não criam nada lá', () => {
    for (const nivel of ['.expediente', 'host']) {
      for (const comando of ['preparar', 'montar', 'rasterizar']) {
        novoHome();
        const f = fora();
        rmSync(join(f.dir, 'sentinela.txt'));
        if (nivel === '.expediente') symlinkSync(f.dir, join(home, '.expediente'));
        else {
          mkdirSync(join(home, '.expediente'));
          symlinkSync(f.dir, join(home, '.expediente/host'));
        }
        const args = { preparar: ['preparar', 'aurora-ficticia'], montar: ['montar', escreverMarca(marcaBase())], rasterizar: ['rasterizar', svgOk(), 'aurora-ficticia', 'x.png'] }[comando];
        sipsFalso(logoPng());
        const r = cli(...args);
        assert.equal(r.code, 1, `${nivel} ${comando}`);
        assert.match(r.erro, /link simbólico/);
        assert.deepEqual(readdirSync(f.dir), [], `${nivel} ${comando}: nada pode ser criado fora`);
      }
    }
  });

  test('rasterizar confere o destino antes de chamar o rasterizador', () => {
    novoHome();
    const f = fora();
    mkdirSync(join(home, '.expediente/host'), { recursive: true });
    symlinkSync(f.dir, join(home, '.expediente/host/temas'));
    const sips = sipsFalso(logoPng());
    assert.equal(cli('rasterizar', svgOk(), 'aurora-ficticia', 'x.png').code, 1);
    assert.equal(sips.chamado(), false);

    novoHome();
    const g = fora();
    mkdirSync(join(pastaDoTema(), 'referencias'), { recursive: true });
    symlinkSync(join(g.dir, 'sentinela.txt'), join(pastaDoTema(), 'referencias/x.png'));
    const sips2 = sipsFalso(logoPng());
    assert.equal(cli('rasterizar', svgOk(), 'aurora-ficticia', 'x.png').code, 1);
    assert.equal(sips2.chamado(), false);
    g.intacto();
  });

  test('o destino que é link simbólico é recusado, com e sem a pré-checagem', () => {
    novoHome();
    const f = fora();
    const alvo = join(f.dir, 'sentinela.txt');
    const elo = join(raiz, `elo-${randomBytes(3).toString('hex')}.png`);
    symlinkSync(alvo, elo);
    assert.throws(() => destinoGravavel(elo), /link simbólico/);
    assert.throws(() => gravarArquivoComum(elo, 'x'), /link simbólico|ELOOP/);
    f.intacto();
  });

  test('o destino que é hard link para arquivo de fora não é sobrescrito', () => {
    novoHome();
    const f = fora();
    mkdirSync(join(pastaDoTema(), 'referencias'), { recursive: true });
    linkSync(join(f.dir, 'sentinela.txt'), join(pastaDoTema(), 'referencias/alvo.png'));
    sipsFalso(logoPng());
    const r = cli('rasterizar', svgOk(), 'aurora-ficticia', 'alvo.png');
    assert.equal(r.code, 1);
    assert.match(r.erro, /mais de um nome|hard link/);
    assert.equal(readFileSync(join(f.dir, 'sentinela.txt'), 'utf8'), 'conteudo do dono');
    const elo = join(raiz, `hl-${randomBytes(3).toString('hex')}`);
    linkSync(join(f.dir, 'sentinela.txt'), elo);
    assert.throws(() => gravarArquivoComum(elo, 'x'), /mais de um nome/);
    assert.equal(readFileSync(join(f.dir, 'sentinela.txt'), 'utf8'), 'conteudo do dono');
  });
});

describe('leitura só de arquivo comum', () => {
  const comElo = (nome, conteudo) => {
    const f = fora();
    writeFileSync(join(f.dir, nome), conteudo);
    const elo = join(raiz, `elo-${randomBytes(3).toString('hex')}-${nome}`);
    symlinkSync(join(f.dir, nome), elo);
    return elo;
  };

  test('paleta, css e rasterizar recusam link simbólico na entrada', () => {
    novoHome();
    for (const [comando, nome, conteudo] of [
      ['paleta', 'logo.png', logoPng()],
      ['css', 'p.css', 'a{color:#c8285a}'],
      ['rasterizar', 'l.svg', SVG_OK],
    ]) {
      const elo = comElo(nome, conteudo);
      const args = comando === 'rasterizar' ? [comando, elo, 'aurora-ficticia', 'x.png'] : [comando, elo];
      sipsFalso(logoPng());
      const r = cli(...args);
      assert.equal(r.code, 1, comando);
      assert.match(r.erro, /não é arquivo comum/, comando);
    }
  });

  test('marca.json e logo que são link simbólico são recusados', () => {
    novoHome();
    const elo = comElo('marca.json', JSON.stringify(marcaBase()));
    const r = cli('montar', elo);
    assert.equal(r.code, 1);
    assert.match(r.erro, /não é arquivo comum/);

    novoHome();
    const logo = comElo('logo.png', logoPng());
    const r2 = cli('montar', escreverMarca(marcaBase({ logo })));
    assert.equal(r2.code, 1);
    assert.match(r2.erro, /logo: não é arquivo comum/);
    assert.equal(existsSync(join(home, '.expediente')), false);
  });
});

describe('tetos de tamanho', () => {
  const cabecalho = (png, l, a, entrelacado = 0) => {
    const b = Buffer.from(png);
    b.writeUInt32BE(l, 16);
    b.writeUInt32BE(a, 20);
    b[28] = entrelacado;
    return b;
  };
  const idat = (corpo) => {
    const h = Buffer.alloc(8);
    h.writeUInt32BE(corpo.length, 0);
    h.write('IDAT', 4, 'latin1');
    return Buffer.concat([h, corpo, Buffer.alloc(4)]);
  };
  const pngCom = (l, a, linhasInfladas) => {
    const base = gravarPng({ largura: 1, altura: 1, rgba: new Uint8Array(4) });
    const cab = cabecalho(base, l, a);
    const ini = 8 + 25;
    return Buffer.concat([cab.subarray(0, ini), idat(deflateSync(linhasInfladas)), cab.subarray(cab.length - 12)]);
  };

  test('PNG acima de 4 MB é recusado por lerPng e, como logo, pelo teto próprio', () => {
    const grande = Buffer.concat([logoPng(), Buffer.alloc(4 * MB + 1)]);
    assert.throws(() => lerPng(grande), /passa do teto de 4194304/);
    novoHome();
    writeFileSync(join(raiz, 'grande.png'), grande);
    const r = cli('montar', escreverMarca(marcaBase({ logo: 'grande.png' })));
    assert.equal(r.code, 1);
    assert.match(r.erro, /logo: \d+ bytes, o teto é/);
  });

  test('paleta confere o tamanho antes de ler o arquivo', () => {
    novoHome();
    const f = join(raiz, 'enorme.bin');
    writeFileSync(f, Buffer.alloc(4 * MB + 1));
    const r = cli('paleta', f);
    assert.equal(r.code, 1);
    assert.match(r.erro, /acima de 4194304 bytes/);
  });

  test('PNG de 4096x4096 passa do teto de pixels mesmo com cada lado no limite', () => {
    assert.throws(() => lerPng(pngCom(4096, 4096, Buffer.alloc(1))), /passa do teto/);
  });

  test('IDAT que infla além do declarado é recusado', () => {
    const png = pngCom(8, 8, Buffer.alloc(10 * MB));
    assert.ok(png.length < 100_000);
    assert.throws(() => lerPng(png));
  });

  test('PNG entrelaçado é recusado', () => {
    const png = logoPng();
    png[28] = 1;
    assert.throws(() => lerPng(png), /entrelaçado/);
  });

  test('CSS acima de 1 MB e marca.json acima de 64 KB são recusados', () => {
    novoHome();
    const css = join(raiz, 'grande.css');
    writeFileSync(css, `a{color:#c8285a}${' '.repeat(MB)}`);
    const r = cli('css', css);
    assert.equal(r.code, 1);
    assert.match(r.erro, /acima de 1048576 bytes/);

    const m = escreverMarca(JSON.stringify(marcaBase()) + ' '.repeat(64 * 1024));
    const r2 = cli('montar', m);
    assert.equal(r2.code, 1);
    assert.match(r2.erro, /acima de 64 KB/);
  });

  test('SVG acima de 1 MB é recusado por reescreverSvg e pelo comando', () => {
    assert.throws(() => reescreverSvg(Buffer.from(SVG_OK + ' '.repeat(MB))), /maior que o limite/);
    novoHome();
    const grande = join(raiz, 'grande.svg');
    writeFileSync(grande, SVG_OK + ' '.repeat(MB));
    const sips = sipsFalso(logoPng());
    const r = cli('rasterizar', grande, 'aurora-ficticia', 'x.png');
    assert.equal(r.code, 1);
    assert.match(r.erro, /SVG acima de/);
    assert.equal(sips.chamado(), false);
  });

  test('o lado do rasterizar precisa ser inteiro entre 8 e 512', () => {
    novoHome();
    for (const lado of ['4', '513', '64.5', 'abc']) {
      const sips = sipsFalso(logoPng());
      const r = cli('rasterizar', svgOk(), 'aurora-ficticia', 'x.png', lado);
      assert.equal(r.code, 1, lado);
      assert.match(r.erro, /lado/);
      assert.equal(sips.chamado(), false, lado);
    }
  });

  test('imagem lisa ou transparente devolvida pelo rasterizador é recusada', () => {
    novoHome();
    for (const cor of [[10, 20, 30, 255], [0, 0, 0, 0]]) {
      const rgba = new Uint8Array(16 * 16 * 4);
      for (let i = 0; i < 256; i++) rgba.set(cor, i * 4);
      sipsFalso(gravarPng({ largura: 16, altura: 16, rgba }));
      const r = cli('rasterizar', svgOk(), 'aurora-ficticia', 'x.png');
      assert.equal(r.code, 1);
      assert.match(r.erro, /vazia ou lisa/);
    }
  });
});

describe('formato', () => {
  const S = (corpo, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg"${attrs}>${corpo}</svg>`;
  const recusa = (texto) => assert.throws(() => reescreverSvg(Buffer.from(texto)), /SVG recusado/);

  test('aninhamento: 32 níveis passam, 33 não', () => {
    const aninhado = (n) => S('<g>'.repeat(n) + '</g>'.repeat(n));
    assert.doesNotThrow(() => reescreverSvg(Buffer.from(aninhado(31))));
    recusa(aninhado(32));
  });

  test('atributo repetido, xmlns de outro endereço e comentário com "--"', () => {
    recusa(S('<rect width="1" width="2"/>'));
    recusa('<svg xmlns="http://exemplo.invalido/svg"/>');
    recusa(S('<!-- a -- b -->'));
  });

  test('caractere de controle no caminho e chave extra em tipografia', () => {
    novoHome();
    const r = cli('montar', escreverMarca(marcaBase({ logo: 'a\u0001.png' })));
    assert.equal(r.code, 1);
    assert.match(r.erro, /caractere de controle/);
    const r2 = cli('montar', escreverMarca(marcaBase({ tipografia: { equivalenteDe: 'X', familia: 'Y' } })));
    assert.equal(r2.code, 1);
    assert.match(r2.erro, /só aceita "equivalenteDe"/);
  });

  test('css só conta #hex que termina ali, não o que está dentro de uma palavra', () => {
    novoHome();
    const css = join(raiz, 'palavras.css');
    writeFileSync(css, '.a{x:#abcxyz}.b{x:#abcdef0123}.c{x:#fff-bar}.d{x:#c8285a}');
    const r = cli('css', css);
    assert.equal(r.code, 0);
    assert.equal(r.saida, '#c8285a  1x\n');
  });
});
