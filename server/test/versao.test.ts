import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { compararSemver, lerVersao } from '../../shared/versao';
import { ARQUIVO, executar, gravar, parseVersaoArgs, ultimaRelease } from '../../scripts/versao';
import { createVersaoReader } from '../versao';
import { tempDir } from './fixtures';

const EXP = { ultima: '1.2.0', publicadaEm: '2026-10-01T12:00:00Z', url: 'https://github.com/isdiegoalves/expediente-ia/releases/tag/v1.2.0' };
const ORIGEM = { nome: 'Projeto X', ultima: '0.9.0', publicadaEm: '2026-09-30T10:00:00Z', url: 'https://example.com/x/releases/v0.9.0', analise: 'https://example.com/analise' };
const arquivo = (o: unknown) => JSON.stringify(o);

describe('compararSemver', () => {
  it('compara por número, não por texto', () => {
    expect(compararSemver('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compararSemver('v1.0.0', '1.0.0')).toBe(0);
    expect(compararSemver('0.9.9', '1.0.0')).toBeLessThan(0);
    expect(compararSemver('1.0.0-rc.1', '1.0.0')).toBeNull();
    expect(compararSemver('demo', '1.0.0')).toBeNull();
  });
});

describe('lerVersao', () => {
  it('versão maior é nova; igual e menor não', () => {
    const ver = (emUso: string) => lerVersao(arquivo({ verificadoEm: '2026-10-02T08:00:00Z', expediente: EXP }), emUso);
    expect(ver('1.0.0')).toMatchObject({ nova: true, emUso: '1.0.0', ultima: { versao: '1.2.0', publicadaEm: EXP.publicadaEm, url: EXP.url }, verificadoEm: '2026-10-02T08:00:00Z' });
    expect(ver('1.2.0').nova).toBe(false);
    expect(ver('1.3.0').nova).toBe(false);
  });

  it('arquivo ausente, vazio, cortado ou de outro tipo dá a versão em uso sem nada mais', () => {
    for (const texto of [null, '', '{"expediente": {"ultima": "1.2', '[]', '"x"', 'null']) expect(lerVersao(texto, '1.0.0')).toEqual({ emUso: '1.0.0', nova: false });
  });

  it('campo estranho é ignorado e não vaza para a resposta', () => {
    const v = lerVersao(arquivo({ verificadoEm: '2026-10-02T08:00:00Z', expediente: { ...EXP, segredo: 'x' }, extra: 1 }), '1.0.0');
    expect(JSON.stringify(v)).not.toMatch(/segredo|extra/);
    expect(v.nova).toBe(true);
  });

  it('bloco inválido é descartado sem derrubar o resto', () => {
    const base = { verificadoEm: '2026-10-02T08:00:00Z', expediente: EXP, origem: ORIGEM };
    expect(lerVersao(arquivo({ ...base, expediente: { ...EXP, ultima: 'quebrado' } }), '1.0.0')).toMatchObject({ nova: false, origem: { nome: 'Projeto X' } });
    expect(lerVersao(arquivo({ ...base, expediente: { ...EXP, url: 'javascript:alert(1)' } }), '1.0.0').ultima).toBeUndefined();
    expect(lerVersao(arquivo({ ...base, expediente: { ...EXP, url: 'http://github.com/x' } }), '1.0.0').ultima).toBeUndefined();
    expect(lerVersao(arquivo({ ...base, expediente: { ...EXP, publicadaEm: 'ontem' } }), '1.0.0').ultima).toBeUndefined();
    const semNome = lerVersao(arquivo({ ...base, origem: { ...ORIGEM, nome: '' } }), '1.0.0');
    expect([semNome.nova, semNome.origem]).toEqual([true, undefined]);
    const semData = lerVersao(arquivo({ ...base, verificadoEm: 'nunca' }), '1.0.0');
    expect([semData.nova, semData.verificadoEm]).toEqual([true, undefined]);
  });

  it('origem é opcional e a análise só entra se for https', () => {
    expect(lerVersao(arquivo({ expediente: EXP }), '1.0.0').origem).toBeUndefined();
    expect(lerVersao(arquivo({ origem: ORIGEM }), '1.0.0').origem).toEqual(ORIGEM);
    const { analise: _a, ...semAnalise } = ORIGEM;
    expect(lerVersao(arquivo({ origem: semAnalise }), '1.0.0').origem).toEqual(semAnalise);
    expect(lerVersao(arquivo({ origem: { ...ORIGEM, analise: 'file:///etc/passwd' } }), '1.0.0').origem).toEqual(semAnalise);
  });
});

describe('createVersaoReader', () => {
  let tmp: ReturnType<typeof tempDir>;
  beforeEach(() => (tmp = tempDir()));
  afterEach(() => tmp.cleanup());

  it('relê o arquivo a cada chamada', () => {
    const f = join(tmp.dir, 'versao.json');
    const ler = createVersaoReader(f, '1.0.0');
    expect(ler()).toEqual({ emUso: '1.0.0', nova: false });
    writeFileSync(f, arquivo({ expediente: EXP }));
    expect(ler().nova).toBe(true);
  });

  it('arquivo enorme é ignorado', () => {
    const f = join(tmp.dir, 'versao.json');
    writeFileSync(f, arquivo({ expediente: EXP, lixo: 'x'.repeat(20_000) }));
    expect(createVersaoReader(f, '1.0.0')()).toEqual({ emUso: '1.0.0', nova: false });
  });
});

describe('scripts/versao.ts', () => {
  let tmp: ReturnType<typeof tempDir>;
  const agora = () => new Date('2026-10-10T09:00:00Z');
  const resposta = (corpo: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(corpo), { status }));
  const API = { tag_name: 'v1.2.0', published_at: '2026-10-01T12:00:00Z', html_url: EXP.url, id: 7, body: 'notas' };
  beforeEach(() => {
    tmp = tempDir();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    tmp.cleanup();
  });

  it('opções: pasta padrão na ponte do host, --saida e recusa do desconhecido', () => {
    expect(parseVersaoArgs([], '/home/u').saida).toBe('/home/u/.expediente/host');
    expect(parseVersaoArgs(['--saida', tmp.dir]).saida).toBe(tmp.dir);
    expect(() => parseVersaoArgs(['--saida'])).toThrow(/pasta/);
    expect(() => parseVersaoArgs(['--token', 'x'])).toThrow(/desconhecida/);
  });

  it('consulta a API pública sem token e grava o formato combinado', async () => {
    const buscar = resposta(API);
    expect(await executar({ saida: tmp.dir, help: false }, buscar as unknown as typeof fetch, agora)).toBe(0);
    const [url, init] = buscar.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.github.com/repos/isdiegoalves/expediente-ia/releases/latest');
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(readFileSync(join(tmp.dir, ARQUIVO), 'utf8'))).toEqual({ verificadoEm: '2026-10-10T09:00:00.000Z', expediente: EXP });
    expect(readdirSync(tmp.dir)).toEqual([ARQUIVO]);
  });

  it('o arquivo gravado é o que o servidor lê', async () => {
    await executar({ saida: tmp.dir, help: false }, resposta(API) as unknown as typeof fetch, agora);
    expect(createVersaoReader(join(tmp.dir, ARQUIVO), '1.0.0')()).toMatchObject({ nova: true, ultima: { versao: '1.2.0' } });
  });

  it('falha de rede, status de erro e resposta fora do formato não apagam o arquivo anterior', async () => {
    const f = join(tmp.dir, ARQUIVO);
    gravar(tmp.dir, { versao: '1.1.0', publicadaEm: '2026-09-01T00:00:00Z', url: EXP.url }, agora());
    const antes = readFileSync(f, 'utf8');
    const falhas: Array<typeof fetch> = [
      (async () => {
        throw new TypeError('fetch failed');
      }) as unknown as typeof fetch,
      resposta({ message: 'rate limit' }, 403) as unknown as typeof fetch,
      resposta({}, 404) as unknown as typeof fetch,
      resposta({ ...API, tag_name: 'nightly' }) as unknown as typeof fetch,
      resposta({ ...API, html_url: 'http://github.com/x' }) as unknown as typeof fetch,
      resposta(['x']) as unknown as typeof fetch,
      (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch,
    ];
    for (const buscar of falhas) {
      expect(await executar({ saida: tmp.dir, help: false }, buscar, agora)).toBe(1);
      expect(readFileSync(f, 'utf8')).toBe(antes);
    }
    expect(readdirSync(tmp.dir)).toEqual([ARQUIVO]);
  });

  it('sem arquivo anterior, a falha não cria nada', async () => {
    const pasta = join(tmp.dir, 'nova');
    expect(await executar({ saida: pasta, help: false }, resposta({}, 500) as unknown as typeof fetch, agora)).toBe(1);
    expect(existsSync(pasta)).toBe(false);
  });

  it('preserva o campo origem escrito por outra ferramenta e descarta o resto do arquivo velho', async () => {
    mkdirSync(tmp.dir, { recursive: true });
    writeFileSync(join(tmp.dir, ARQUIVO), arquivo({ verificadoEm: '2026-01-01T00:00:00Z', expediente: { ...EXP, ultima: '0.1.0' }, origem: ORIGEM, velho: true }));
    await executar({ saida: tmp.dir, help: false }, resposta(API) as unknown as typeof fetch, agora);
    expect(JSON.parse(readFileSync(join(tmp.dir, ARQUIVO), 'utf8'))).toEqual({ verificadoEm: '2026-10-10T09:00:00.000Z', expediente: EXP, origem: ORIGEM });
  });

  it('arquivo anterior ilegível não impede a gravação', async () => {
    writeFileSync(join(tmp.dir, ARQUIVO), '{cortado');
    expect(await executar({ saida: tmp.dir, help: false }, resposta(API) as unknown as typeof fetch, agora)).toBe(0);
    expect(JSON.parse(readFileSync(join(tmp.dir, ARQUIVO), 'utf8')).expediente).toEqual(EXP);
  });

  it('ultimaRelease tira o "v" da tag', async () => {
    expect(await ultimaRelease(resposta(API) as unknown as typeof fetch)).toEqual({ versao: '1.2.0', publicadaEm: EXP.publicadaEm, url: EXP.url });
  });
});
