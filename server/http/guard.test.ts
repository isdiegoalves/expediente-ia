import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aleatorioHex, chaveDoCliente, chaveDoToken, provaDoCliente, provaDoServidor, type TokenLido } from '../token';
import { Autenticacao, BILHETE_VALIDADE_MS, DESAFIO_VALIDADE_MS, MAX_DESAFIOS } from './autenticacao';
import { createRequestGuard } from './guard';

const TOKEN = 'c0ffee'.repeat(10) + 'abcd';
const CHAVE = chaveDoToken(TOKEN);
const ok = (token: string): TokenLido => ({ ok: true, token, chave: chaveDoToken(token) });

let server: http.Server;
let port: number;
let token: TokenLido = ok(TOKEN);
let agora = 1_000_000;
let chegaram = 0;

beforeAll(async () => {
  const auth = new Autenticacao(() => token, () => agora);
  const guard = createRequestGuard(auth);
  server = http.createServer((req, res) => {
    if (guard(req, res)) return;
    chegaram++;
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ conta: auth.provou(req) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

interface Resposta {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

function enviar(method: string, path: string, headers: Record<string, string>, corpo?: string): Promise<Resposta> {
  return new Promise((resolve, fail) => {
    const req = http.request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      let body = '';
      res.setEncoding('utf8').on('data', (c: string) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', fail);
    // O cliente do Node só põe corpo com tamanho declarado nestes métodos.
    req.end(corpo ?? (['POST', 'PUT', 'PATCH'].includes(method) ? '{}' : undefined));
  });
}

/** Pede um desafio ao servidor (com o nonce do cliente) e devolve o que ele respondeu. */
async function pedirDesafio(n = aleatorioHex()): Promise<{ desafio: string; prova: string; n: string }> {
  const r = await enviar('GET', `/api/token/desafio?n=${n}`, {});
  return { ...(JSON.parse(r.body) as { desafio: string; prova: string }), n };
}

/** O cabeçalho de prova de um pedido, com um desafio novo. */
async function prova(method: string, path: string, chave = CHAVE): Promise<string> {
  const { desafio } = await pedirDesafio();
  return `${desafio}.${provaDoCliente(chave, desafio, method, path)}`;
}

/** Com a prova certa, a menos que o teste mande o seu `X-Expediente-Prova`. */
async function send(method: string, path: string, headers: Record<string, string> = {}, corpo?: string) {
  const comProva = Object.keys(headers).some((h) => h.toLowerCase() === 'x-expediente-prova') ? headers : { 'X-Expediente-Prova': await prova(method, path), ...headers };
  return enviar(method, path, comProva, corpo);
}

const JSON_CT = { 'Content-Type': 'application/json' };

describe('guard de Host/Origin', () => {
  it('Host evil.example leva 403', async () => {
    expect((await send('GET', '/api/health', { Host: 'evil.example' })).status).toBe(403);
    expect((await send('GET', '/api/health')).status).toBe(200);
  });

  it('POST sem JSON leva 415', async () => {
    expect((await send('POST', '/api/demo', { 'Content-Type': 'text/plain' })).status).toBe(415);
    expect((await send('POST', '/api/demo')).status).toBe(415);
    expect((await send('POST', '/api/demo', JSON_CT)).status).toBe(200);
  });

  it('POST com Origin http://habblaud.localhost:1355 leva 403', async () => {
    const host = `127.0.0.1:${port}`;
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: 'http://habblaud.localhost:1355' })).status).toBe(403);
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: 'http://localhost:5173', Host: host })).status).toBe(403);
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: 'https://evil.example' })).status).toBe(403);
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: `http://${host}` })).status).toBe(200);
  });

  it('nenhuma rota responde Access-Control-*', async () => {
    const respostas = [
      await send('GET', '/api/health', { Origin: 'https://evil.example' }),
      await send('OPTIONS', '/api/demo', { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' }),
      await send('POST', '/api/demo', { ...JSON_CT, Origin: 'https://evil.example' }),
      await send('GET', '/api/health', { Host: 'evil.example' }),
      await send('GET', '/api/token/desafio?n=' + aleatorioHex(), { Origin: 'https://evil.example' }),
    ];
    for (const r of respostas) expect(Object.keys(r.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
});

const nonceDeOutro = () => aleatorioHex();

describe('desafio do servidor', () => {
  beforeEach(() => {
    token = ok(TOKEN);
    chegaram = 0;
  });

  it('responde um desafio de 32 hexadecimais e a prova de que tem o token, sem prova do cliente, e o segredo não aparece', async () => {
    const n = aleatorioHex();
    const r = await enviar('GET', `/api/token/desafio?n=${n}`, {});
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    const j = JSON.parse(r.body) as { desafio: string; prova: string };
    expect(j.desafio).toMatch(/^[0-9a-f]{32}$/);
    expect(j.prova).toBe(provaDoServidor(CHAVE, n));
    expect(r.body).not.toContain(TOKEN);
    expect(chegaram).toBe(0);
  });

  it('a prova do servidor depende do nonce do cliente e de quem tem o token', async () => {
    const [a, b] = [nonceDeOutro(), nonceDeOutro()];
    expect((await pedirDesafio(a)).prova).not.toBe((await pedirDesafio(b)).prova);
    expect((await pedirDesafio(a)).prova).toBe((await pedirDesafio(a)).prova);
    token = ok('f'.repeat(64));
    expect((await pedirDesafio(a)).prova).not.toBe(provaDoServidor(CHAVE, a));
  });

  it('pedido de outro site (um fetch no-cors de qualquer página) leva 403 e não gasta o teto; da mesma origem, de fora do navegador ou sem o cabeçalho passa', async () => {
    for (const site of ['cross-site', 'same-site', 'lixo']) expect((await enviar('GET', `/api/token/desafio?n=${aleatorioHex()}`, { 'Sec-Fetch-Site': site })).status, site).toBe(403);
    for (const site of ['same-origin', 'none']) expect((await enviar('GET', `/api/token/desafio?n=${aleatorioHex()}`, { 'Sec-Fetch-Site': site })).status, site).toBe(200);
    expect((await enviar('GET', `/api/token/desafio?n=${aleatorioHex()}`, {})).status).toBe(200);
    const primeiro = await prova('POST', '/api/demo');
    for (let i = 0; i < MAX_DESAFIOS + 5; i++) await enviar('GET', `/api/token/desafio?n=${aleatorioHex()}`, { 'Sec-Fetch-Site': 'cross-site' });
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': primeiro })).status).toBe(200);
  });

  it('nonce ausente, curto, longo, maiúsculo ou repetido na consulta leva 400, e só GET e HEAD atendem', async () => {
    for (const q of ['', '?n=', '?n=abc', `?n=${'a'.repeat(33)}`, `?n=${'A'.repeat(32)}`, `?n=${'g'.repeat(32)}`, `?n[]=${'a'.repeat(32)}`]) {
      expect((await enviar('GET', `/api/token/desafio${q}`, {})).status, q).toBe(400);
    }
    for (const m of ['POST', 'PUT', 'DELETE']) expect((await enviar(m, `/api/token/desafio?n=${aleatorioHex()}`, JSON_CT)).status, m).toBe(405);
    expect((await enviar('HEAD', `/api/token/desafio?n=${aleatorioHex()}`, {})).status).toBe(200);
    expect(chegaram).toBe(0);
  });

  it('vale 60 s e é de uso único; o teto de desafios vivos expulsa os mais antigos', async () => {
    const p = await prova('POST', '/api/demo');
    agora += DESAFIO_VALIDADE_MS;
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': p })).status).toBe(200);
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': p })).status).toBe(401);
    const vencido = await prova('POST', '/api/demo');
    agora += DESAFIO_VALIDADE_MS + 1;
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': vencido })).status).toBe(401);
    const primeiro = await prova('POST', '/api/demo');
    for (let i = 0; i < MAX_DESAFIOS; i++) await pedirDesafio();
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': primeiro })).status).toBe(401);
    expect((await send('POST', '/api/demo', JSON_CT)).status).toBe(200);
  });
});

const ROTAS_DE_ESCRITA = [
  '/api/permissions',
  '/api/permissions/p1/decision',
  `/api/mod/focos/${'a'.repeat(32)}/assumir`,
  `/api/mod/focos/${'a'.repeat(32)}/resultado`,
  '/api/agentes/x/focar',
  '/api/agents/x/character',
  '/api/rooms/rename',
  '/api/social/ritmo',
  '/api/demo',
  '/api/resumo/presenca',
  '/api/agents/x/terminal',
  '/api/token/bilhete',
  '/api',
];
const METODOS_DE_ESCRITA = ['POST', 'PUT', 'DELETE', 'PATCH'];

describe('prova do token local nas escritas', () => {
  beforeEach(() => {
    token = ok(TOKEN);
    chegaram = 0;
  });

  it('todo método de escrita em toda rota de escrita leva 401 sem prova válida, e nada chega à rota', async () => {
    const valida = (m: string, p: string) => prova(m, p);
    const variantes: Array<[string, (m: string, p: string) => Promise<string | undefined>]> = [
      ['sem cabeçalho', async () => undefined],
      ['vazio', async () => ''],
      ['sem o ponto', async () => 'a'.repeat(96)],
      ['desafio curto', async () => `${'a'.repeat(31)}.${'b'.repeat(64)}`],
      ['prova curta', async () => `${'a'.repeat(32)}.${'b'.repeat(63)}`],
      ['hexadecimal maiúsculo', async (m, p) => (await valida(m, p)).toUpperCase()],
      ['desafio que o servidor nunca emitiu', async (m, p) => `${'a'.repeat(32)}.${provaDoCliente(CHAVE, 'a'.repeat(32), m, p)}`],
      ['prova errada de um desafio vivo', async () => `${(await pedirDesafio()).desafio}.${'0'.repeat(64)}`],
      ['prova de outro token', async (m, p) => valida(m, p).then(async () => prova(m, p, chaveDoToken('f'.repeat(64))))],
      ['o segredo em claro no lugar da prova', async () => TOKEN],
      ['a resposta do desafio usada como prova do cliente', async () => {
        const d = await pedirDesafio();
        return `${d.desafio}.${d.prova}`;
      }],
      ['a prova do servidor sobre o próprio desafio', async () => {
        const d = await pedirDesafio();
        return `${d.desafio}.${provaDoServidor(CHAVE, d.desafio)}`;
      }],
      ['prova de outro método', async (m, p) => prova(m === 'POST' ? 'PUT' : 'POST', p)],
      ['prova de outro caminho', async (m, p) => prova(m, `${p}x`)],
      ['prova sem a consulta', async (m, p) => prova(m, p.split('?')[0]!)],
      ['duas provas', async (m, p) => `${await valida(m, p)}, ${await valida(m, p)}`],
    ];
    for (const m of METODOS_DE_ESCRITA) {
      for (const p of ROTAS_DE_ESCRITA) {
        for (const [nome, montar] of variantes) {
          const cabecalho = await montar(m, `${p}?x=1`);
          const r = await enviar(m, `${p}?x=1`, { ...JSON_CT, ...(cabecalho === undefined ? {} : { 'X-Expediente-Prova': cabecalho }) });
          expect(r.status, `${m} ${p} ${nome}`).toBe(401);
          expect(r.headers['content-type']).toMatch(/^application\/json/);
          expect(JSON.parse(r.body).error).toMatch(/prova/i);
          expect(r.body).not.toContain(TOKEN);
        }
      }
    }
    expect(chegaram).toBe(0);
  });

  it('com a prova certa a escrita passa, em todas as rotas e métodos (o bilhete e a troca respondem pelo guard)', async () => {
    const guardaRespondeu = new Set(['/api/token/bilhete']);
    let esperados = 0;
    for (const m of METODOS_DE_ESCRITA) {
      for (const p of ROTAS_DE_ESCRITA) {
        const r = await send(m, p, JSON_CT);
        if (guardaRespondeu.has(p)) expect([200, 405], `${m} ${p}`).toContain(r.status);
        else {
          expect(r.status, `${m} ${p}`).toBe(200);
          esperados++;
        }
      }
    }
    expect(chegaram).toBe(esperados);
  });

  it('a prova vale uma vez: repetir o mesmo cabeçalho leva 401', async () => {
    const cabecalho = await prova('POST', '/api/demo');
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': cabecalho })).status).toBe(200);
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': cabecalho })).status).toBe(401);
    expect(chegaram).toBe(1);
  });

  it('prova errada também gasta o desafio: não dá para tentar de novo com o mesmo', async () => {
    const { desafio } = await pedirDesafio();
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': `${desafio}.${'0'.repeat(64)}` })).status).toBe(401);
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': `${desafio}.${provaDoCliente(CHAVE, desafio, 'POST', '/api/demo')}` })).status).toBe(401);
  });

  it('o token é cobrado antes do Content-Type: pedido forjado sem os dois leva 401, não 415', async () => {
    expect((await enviar('POST', '/api/demo', {})).status).toBe(401);
    expect((await send('POST', '/api/demo', { 'Content-Type': 'text/plain' })).status).toBe(415);
  });

  it('caminho com segmentos .. ou %2e que a rota lê como /api/ também é cobrado; a prova é sobre o caminho como veio', async () => {
    for (const p of ['/x/../api/demo', '/x/%2e%2e/api/permissions', '/./api/demo', '/api/./demo']) {
      expect((await enviar('POST', p, JSON_CT)).status, p).toBe(401);
      expect((await send('POST', p, JSON_CT)).status, p).toBe(200);
      expect((await enviar('POST', p, { ...JSON_CT, 'X-Expediente-Prova': await prova('POST', '/api/demo') })).status, `${p} com a prova do caminho limpo`).toBe(401);
    }
  });

  it('OPTIONS em /api/ também exige a prova; fora de /api/ nada é cobrado', async () => {
    expect((await enviar('OPTIONS', '/api/demo', {})).status).toBe(401);
    expect((await send('OPTIONS', '/api/demo')).status).toBe(200);
    expect((await enviar('POST', '/fora/da/api', JSON_CT)).status).toBe(200);
  });

  it('GET e HEAD que só leem não mudam: passam sem cabeçalho e com cabeçalho errado', async () => {
    for (const m of ['GET', 'HEAD']) {
      expect((await enviar(m, '/api/snapshot', {})).status).toBe(200);
      expect((await enviar(m, '/api/permissions/p1', { 'X-Expediente-Prova': 'errado' })).status).toBe(200);
    }
  });

  it('Origin de fora continua levando 403, mesmo com a prova certa', async () => {
    expect((await send('POST', '/api/demo', { ...JSON_CT, Origin: 'https://evil.example' })).status).toBe(403);
  });

  it('servidor sem token legível recusa toda escrita (503), até o desafio, o bilhete e a troca, e a leitura segue', async () => {
    token = { ok: false, motivo: 'o arquivo do token não existe ou não pode ser lido' };
    for (const m of METODOS_DE_ESCRITA) {
      for (const cab of [`${'a'.repeat(32)}.${'b'.repeat(64)}`, '', 'x']) {
        const r = await enviar(m, '/api/permissions/p1/decision', { ...JSON_CT, 'X-Expediente-Prova': cab });
        expect(r.status, m).toBe(503);
        expect(JSON.parse(r.body).error).toContain('o arquivo do token não existe');
      }
    }
    expect((await enviar('GET', `/api/token/desafio?n=${aleatorioHex()}`, {})).status).toBe(503);
    expect((await enviar('POST', '/api/token/troca', { ...JSON_CT }, JSON.stringify({ bilhete: aleatorioHex() }))).status).toBe(503);
    expect((await enviar('POST', '/api/token/bilhete', JSON_CT)).status).toBe(503);
    expect((await enviar('GET', '/api/permissions/p1/wait', {})).status).toBe(503);
    expect((await enviar('GET', '/api/health', {})).status).toBe(200);
    expect(chegaram).toBe(1);
  });

  it('o arquivo é relido a cada escrita: o token novo vale e as provas do antigo deixam de valer sem reiniciar', async () => {
    const antigo = await prova('POST', '/api/demo');
    token = ok('f'.repeat(64));
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': antigo })).status).toBe(401);
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': await prova('POST', '/api/demo', chaveDoToken('f'.repeat(64))) })).status).toBe(200);
  });
});

describe('GET que muda estado exige a prova', () => {
  beforeEach(() => {
    token = ok(TOKEN);
    chegaram = 0;
  });
  const GETS = ['/api/permissions/p1/wait?timeout=1', '/api/mod/focos', '/api/agentes/x/ir', '/api/agentes/x%3A1/ir'];

  it('sem prova, com prova errada, vencida ou de outro caminho: 401, e nada chega à rota (GET e HEAD)', async () => {
    for (const m of ['GET', 'HEAD']) {
      for (const p of GETS) {
        expect((await enviar(m, p, {})).status, `${m} ${p}`).toBe(401);
        expect((await enviar(m, p, { 'X-Expediente-Prova': `${'a'.repeat(32)}.${'b'.repeat(64)}` })).status, `${m} ${p} errada`).toBe(401);
        expect((await enviar(m, p, { 'X-Expediente-Prova': await prova(m, `${p}x`) })).status, `${m} ${p} outro caminho`).toBe(401);
        expect((await enviar(m, p, { 'X-Expediente-Prova': await prova(m === 'GET' ? 'POST' : 'GET', p) })).status, `${m} ${p} outro método`).toBe(401);
        const vencida = await prova(m, p);
        agora += DESAFIO_VALIDADE_MS + 1;
        expect((await enviar(m, p, { 'X-Expediente-Prova': vencida })).status, `${m} ${p} vencida`).toBe(401);
      }
    }
    expect(chegaram).toBe(0);
  });

  it('com a prova certa passa, uma vez só', async () => {
    for (const p of GETS) {
      const cabecalho = await prova('GET', p);
      expect((await enviar('GET', p, { 'X-Expediente-Prova': cabecalho })).status, p).toBe(200);
      expect((await enviar('GET', p, { 'X-Expediente-Prova': cabecalho })).status, `${p} repetida`).toBe(401);
    }
  });

  it('o /ir?abrir=1 (a navegação do navegador, com o nonce como credencial) e os GET que só leem seguem sem cabeçalho', async () => {
    for (const p of ['/api/agentes/x/ir?abrir=1&n=abc', '/api/agentes/x/ir?n=1&abrir=1', '/api/permissions/p1', '/api/focos/' + 'a'.repeat(32), '/api/mod/summary', '/api/resumo', '/api/agents/x', '/api/snapshot', '/api/health']) {
      expect((await enviar('GET', p, {})).status, p).toBe(200);
    }
    for (const p of ['/api/agentes/x/ir?abrir=0', '/api/agentes/x/ir?abrir=11', '/api/agentes/x/ir?abrir']) {
      expect((await enviar('GET', p, {})).status, p).toBe(401);
    }
  });
});

describe('bilhete e troca', () => {
  beforeEach(() => {
    token = ok(TOKEN);
    chegaram = 0;
  });
  const troca = (bilhete: unknown, headers: Record<string, string> = {}) => enviar('POST', '/api/token/troca', { ...JSON_CT, ...headers }, JSON.stringify({ bilhete }));
  const bilhete = async () => ((JSON.parse((await send('POST', '/api/token/bilhete', JSON_CT)).body) as { bilhete: string }).bilhete);

  it('o bilhete exige a prova de cliente como toda escrita', async () => {
    expect((await enviar('POST', '/api/token/bilhete', JSON_CT)).status).toBe(401);
    const r = await send('POST', '/api/token/bilhete', JSON_CT);
    expect(r.status).toBe(200);
    expect((JSON.parse(r.body) as { bilhete: string }).bilhete).toMatch(/^[0-9a-f]{32}$/);
    expect(r.body).not.toContain(TOKEN);
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('a troca devolve a chave do cliente (nunca o token) uma vez, sem prova de cliente, e sem guardar em cache', async () => {
    const b = await bilhete();
    const r = await troca(b);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.body)).toEqual({ chave: chaveDoCliente(CHAVE).toString('hex') });
    expect(r.body).not.toContain(TOKEN);
    expect(r.headers['cache-control']).toBe('no-store');
    const de = await troca(b);
    expect(de.status).toBe(401);
    expect(de.body).not.toContain(TOKEN);
  });

  it('bilhete inventado, vencido, reusado, de formato errado ou de outro tipo: o segredo não sai', async () => {
    const r401 = await troca(aleatorioHex());
    expect(r401.status).toBe(401);
    expect(r401.body).not.toContain(TOKEN);
    for (const b of ['abc', 'A'.repeat(32), 123, null, ['a'], { a: 1 }, '']) {
      const r = await troca(b);
      expect(r.status, String(b)).toBe(400);
      expect(r.body).not.toContain(TOKEN);
    }
    const velho = await bilhete();
    agora += BILHETE_VALIDADE_MS + 1;
    const r = await troca(velho);
    expect(r.status).toBe(401);
    expect(r.body).not.toContain(TOKEN);
    const limite = await bilhete();
    agora += BILHETE_VALIDADE_MS;
    expect((await troca(limite)).status).toBe(200);
  });

  it('a chave que a troca entrega assina provas de cliente que o guard aceita, mas não a prova do servidor; a do desenho anterior (o token como chave) leva 401', async () => {
    const entregue = Buffer.from((JSON.parse((await troca(await bilhete())).body) as { chave: string }).chave, 'hex');
    const assina = (chave: Buffer, mensagem: string) => createHmac('sha256', chave).update(mensagem).digest('hex');
    const comoCliente = async (chave: Buffer) => {
      const { desafio } = await pedirDesafio();
      return enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': `${desafio}.${assina(chave, `cliente\n${desafio}\nPOST\n/api/demo`)}` });
    };
    expect((await comoCliente(entregue)).status).toBe(200);
    expect((await comoCliente(CHAVE)).status).toBe(401);
    const n = aleatorioHex();
    expect(assina(entregue, `servidor\n${n}`)).not.toBe(provaDoServidor(CHAVE, n));
    expect(assina(entregue, `servidor\n${n}`)).not.toBe(assina(CHAVE, `servidor\n${n}`));
  });

  it('o desafio não serve de bilhete, e o bilhete não serve de desafio', async () => {
    const d = await pedirDesafio();
    expect((await troca(d.desafio)).status).toBe(401);
    const b = await bilhete();
    expect((await enviar('POST', '/api/demo', { ...JSON_CT, 'X-Expediente-Prova': `${b}.${'0'.repeat(64)}` })).status).toBe(401);
  });

  it('a troca recusa o que não é JSON (415), outra origem (403), pedido de outro site (403) e corpo grande ou torto (400)', async () => {
    const b = await bilhete();
    expect((await enviar('POST', '/api/token/troca', { 'Content-Type': 'text/plain' }, JSON.stringify({ bilhete: b }))).status).toBe(415);
    expect((await troca(b, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await troca(b, { 'Sec-Fetch-Site': 'cross-site' })).status).toBe(403);
    expect((await enviar('POST', '/api/token/troca', JSON_CT, '{')).status).toBe(400);
    expect((await enviar('POST', '/api/token/troca', JSON_CT, JSON.stringify({ bilhete: b, lixo: 'x'.repeat(5_000) }))).status).toBe(400);
    expect((await troca(b)).status).toBe(200);
  });

  it('PUT e DELETE na troca levam 405, e o teto de bilhetes vivos expulsa os mais antigos', async () => {
    for (const m of ['PUT', 'DELETE', 'PATCH']) expect((await enviar(m, '/api/token/troca', JSON_CT, m === 'DELETE' ? undefined : JSON.stringify({ bilhete: aleatorioHex() }))).status, m).toBe(405);
    const primeiro = await bilhete();
    for (let i = 0; i < 64; i++) await bilhete();
    expect((await troca(primeiro)).status).toBe(401);
  });
});

describe('o stream conta como página só com prova', () => {
  beforeEach(() => {
    token = ok(TOKEN);
    chegaram = 0;
  });
  const conta = async (caminho: string, headers: Record<string, string> = {}) => {
    const r = await enviar('GET', caminho, headers);
    return { status: r.status, conta: (JSON.parse(r.body) as { conta: boolean }).conta };
  };
  const provaDoStream = async (metodo = 'GET', caminho = '/api/stream') => prova(metodo, caminho);

  it('sem prova o stream é atendido e não conta', async () => {
    expect(await conta('/api/stream')).toEqual({ status: 200, conta: false });
  });

  it('com a prova certa na query conta, uma vez só (a mesma prova de novo é atendida e não conta)', async () => {
    const p = await provaDoStream();
    expect(await conta(`/api/stream?prova=${p}`)).toEqual({ status: 200, conta: true });
    expect(await conta(`/api/stream?prova=${p}`)).toEqual({ status: 200, conta: false });
  });

  it('prova de outro método ou caminho, errada, vencida, malformada, repetida ou com outro parâmetro: o stream é atendido e não conta', async () => {
    const vencida = await provaDoStream();
    agora += DESAFIO_VALIDADE_MS + 1;
    const outras = [
      `/api/stream?prova=${await provaDoStream('POST')}`,
      `/api/stream?prova=${await provaDoStream('GET', '/api/demo')}`,
      `/api/stream?prova=${await provaDoStream('GET', '/api/stream?x=1')}`,
      `/api/stream?prova=${(await pedirDesafio()).desafio}.${'0'.repeat(64)}`,
      `/api/stream?prova=${vencida}`,
      '/api/stream?prova=curto',
      '/api/stream?prova=',
      `/api/stream?prova=${await provaDoStream()}&x=1`,
      `/api/stream?x=1&prova=${await provaDoStream()}`,
      `/api/stream?prova=${await provaDoStream()}&prova=${await provaDoStream()}`,
      `/api/stream/?prova=${await provaDoStream()}`,
    ];
    for (const caminho of outras) expect(await conta(caminho), caminho).toEqual({ status: 200, conta: false });
  });

  it('o cabeçalho de prova não faz o stream contar (só a query), e outra rota GET com prova na query não conta', async () => {
    expect(await conta('/api/stream', { 'X-Expediente-Prova': await provaDoStream() })).toEqual({ status: 200, conta: false });
    expect(await conta(`/api/snapshot?prova=${await provaDoStream('GET', '/api/snapshot')}`)).toEqual({ status: 200, conta: false });
  });

  it('a marca é conferida a cada contagem: trocado o token, o stream que provou com o anterior deixa de contar, e o que prova com o novo conta', async () => {
    const auth = new Autenticacao(() => token, () => agora);
    const guard = createRequestGuard(auth);
    const abrir = async (provaDe: Buffer) => {
      const desafio = auth.emitirDesafio();
      const caminho = `/api/stream?prova=${desafio}.${provaDoCliente(provaDe, desafio, 'GET', '/api/stream')}`;
      const req = { method: 'GET', url: caminho, headers: { host: '127.0.0.1:1' } } as unknown as http.IncomingMessage;
      guard(req, { writeHead: () => undefined, end: () => undefined } as unknown as http.ServerResponse);
      return req;
    };
    const antigo = await abrir(CHAVE);
    expect(auth.provou(antigo)).toBe(true);
    const novoToken = 'f'.repeat(64);
    token = ok(novoToken);
    expect(auth.provou(antigo)).toBe(false);
    const novo = await abrir(chaveDoToken(novoToken));
    expect(auth.provou(novo)).toBe(true);
    expect(auth.provou(antigo)).toBe(false);
    token = { ok: false, motivo: 'sumiu' };
    expect(auth.provou(novo)).toBe(false);
    token = ok(TOKEN);
  });

  it('servidor sem token legível: o stream é atendido e não conta', async () => {
    const p = await provaDoStream();
    token = { ok: false, motivo: 'o arquivo do token não existe ou não pode ser lido' };
    expect(await conta(`/api/stream?prova=${p}`)).toEqual({ status: 200, conta: false });
  });
});
