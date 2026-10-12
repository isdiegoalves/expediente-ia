import { describe, expect, it, vi } from 'vitest';
import { type ArmazemDeChave, AVISO_SEM_TOKEN, AVISO_TOKEN_RECUSADO, TOKEN_CABECALHO, TokenLocal } from './token';

// Os mesmos vetores dos outros lados (server/test/prova-vetores.test.ts), conferidos com openssl. TOKEN é K (a página nunca o tem);
// CHAVE é a chave do cliente, SHA-256("expediente/cliente\n" ‖ K), o que o servidor entrega na troca do bilhete.
const TOKEN = '5e17e11a'.repeat(8);
const CHAVE = 'a69dc70bd79ca70a947af7c6984ae0f2e4dc1604dcb5b97ef9fca5374600e78c';
const DESAFIO = 'fedcba9876543210fedcba9876543210';
const BILHETE = '00112233445566778899aabbccddeeff';
const CLIENTE_POST = '186816cb2fb8ea208d90176df76ed2b6053c76390b48f55a0a804453b0c3418e';
const CAMINHO = '/api/permissions/p-1/decision?x=1';

function armazem(inicial: CryptoKey | null = null) {
  const estado = { chave: inicial, gravacoes: 0, apagou: 0 };
  const a: ArmazemDeChave = {
    ler: async () => estado.chave,
    gravar: async (c) => {
      estado.chave = c;
      estado.gravacoes++;
    },
    apagar: async () => {
      estado.chave = null;
      estado.apagou++;
    },
  };
  return { estado, a };
}

interface Chamada {
  url: string;
  init: RequestInit;
}

/** Um "servidor": responde a troca, o desafio (sempre `DESAFIO`) e o resto com `resto`, e anota cada chamada. */
function servidor(opts: { troca?: () => Response; desafio?: () => Response; resto?: () => Response } = {}) {
  const chamadas: Chamada[] = [];
  const buscar = async (url: string, init: RequestInit = {}) => {
    chamadas.push({ url, init });
    if (url === '/api/token/troca') return opts.troca?.() ?? new Response(JSON.stringify({ chave: CHAVE }), { status: 200 });
    if (url.startsWith('/api/token/desafio')) return opts.desafio?.() ?? new Response(JSON.stringify({ desafio: DESAFIO, prova: 'x' }), { status: 200 });
    return opts.resto?.() ?? new Response('{}', { status: 200 });
  };
  return { chamadas, buscar };
}

const fragmento = (hash: string) => ({ hash, pathname: '/', search: '?mock=1' });

/** Uma página que já trocou o bilhete: com a chave e o armazém que a guardou. */
async function comChave(s = servidor()) {
  const arm = armazem();
  const alvo = new TokenLocal(arm.a, s.buscar);
  await alvo.receberDaUrl(fragmento(`#b=${BILHETE}`), { replaceState: () => {} });
  s.chamadas.length = 0;
  return { alvo, arm, s };
}

const cabecalho = (init: RequestInit) => new Headers(init.headers).get(TOKEN_CABECALHO);

describe('bilhete no fragmento da URL', () => {
  it('tira o fragmento da barra antes de qualquer chamada, troca o bilhete e guarda uma chave que não se exporta', async () => {
    const eventos: string[] = [];
    const s = servidor();
    const arm = armazem();
    const alvo = new TokenLocal(arm.a, async (url, init) => {
      eventos.push(`fetch ${url}`);
      return s.buscar(url, init);
    });
    await alvo.receberDaUrl(fragmento(`#b=${BILHETE}`), { replaceState: (_e, _t, url) => void eventos.push(`replaceState ${url}`) });
    expect(eventos).toEqual(['replaceState /?mock=1', 'fetch /api/token/troca']);
    expect(JSON.parse(s.chamadas[0]!.init.body as string)).toEqual({ bilhete: BILHETE });
    expect(s.chamadas[0]!.init.method).toBe('POST');
    expect(alvo.tem()).toBe(true);
    expect(alvo.carregado).toBe(true);
    const guardada = arm.estado.chave!;
    expect(guardada.extractable).toBe(false);
    expect(guardada.usages).toEqual(['sign']);
    expect(guardada.algorithm).toMatchObject({ name: 'HMAC' });
    await expect(globalThis.crypto.subtle.exportKey('raw', guardada)).rejects.toThrow();
  });

  it('o segredo não fica em localStorage, sessionStorage, cookie nem em nada que a página guarde como texto', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem, removeItem: () => {} });
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem, removeItem: () => {} });
    try {
      const { arm } = await comChave();
      expect(setItem).not.toHaveBeenCalled();
      expect(JSON.stringify(Object.entries(arm.estado))).not.toContain(CHAVE);
      expect(JSON.stringify(Object.entries(arm.estado))).not.toContain(TOKEN);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('o #t= antigo (com o segredo), bilhete de formato errado e lixo: o fragmento sai da barra, nada é trocado', async () => {
    for (const hash of [`#t=${TOKEN}`, `#t=${BILHETE}`, '#t=', '#b=', '#b=curto', `#b=${BILHETE}0`, `#b=${BILHETE.toUpperCase()}`, `#b=${BILHETE}&x=1`, `#b=${'g'.repeat(32)}`]) {
      const s = servidor();
      const trocas: string[] = [];
      const alvo = new TokenLocal(armazem().a, s.buscar);
      await alvo.receberDaUrl(fragmento(hash), { replaceState: (_e, _t, url) => void trocas.push(url) });
      expect(trocas, hash).toEqual(['/?mock=1']);
      expect(s.chamadas, hash).toEqual([]);
      expect(alvo.tem(), hash).toBe(false);
    }
  });

  it('fragmento que não é do token fica como está', async () => {
    const s = servidor();
    const trocas: string[] = [];
    const alvo = new TokenLocal(armazem().a, s.buscar);
    for (const hash of ['', '#', '#sala-2', `#x=1&b=${BILHETE}`, `b=${BILHETE}`]) await alvo.receberDaUrl(fragmento(hash), { replaceState: (_e, _t, url) => void trocas.push(url) });
    expect(trocas).toEqual([]);
    expect(s.chamadas).toEqual([]);
  });

  it('bilhete recusado, conexão que cai ou resposta torta: sem chave, sem exceção, e a chave que já havia fica', async () => {
    const respostas: Array<() => Response> = [
      () => new Response('{}', { status: 401 }),
      () => new Response('lixo', { status: 200 }),
      () => new Response(JSON.stringify({ chave: 'curto' }), { status: 200 }),
      () => new Response(JSON.stringify({ chave: 'G'.repeat(64) }), { status: 200 }),
      () => new Response(JSON.stringify({}), { status: 200 }),
    ];
    for (const troca of respostas) {
      const alvo = new TokenLocal(armazem().a, servidor({ troca }).buscar);
      await alvo.receberDaUrl(fragmento(`#b=${BILHETE}`), { replaceState: () => {} });
      expect(alvo.tem()).toBe(false);
      expect(alvo.carregado).toBe(true);
    }
    const cai = new TokenLocal(armazem().a, async () => {
      throw new TypeError('failed to fetch');
    });
    await cai.receberDaUrl(fragmento(`#b=${BILHETE}`), { replaceState: () => {} });
    expect(cai.tem()).toBe(false);
    const { alvo } = await comChave();
    await alvo.receberDaUrl(fragmento('#b=curto'), { replaceState: () => {} });
    expect(alvo.tem()).toBe(true);
  });

  it('a chave guardada na visita anterior vale; armazém que falha deixa a chave só na memória', async () => {
    const { arm } = await comChave();
    const nova = new TokenLocal(armazem(arm.estado.chave).a, servidor().buscar);
    await nova.iniciar();
    expect(nova.tem()).toBe(true);
    const quebrado: ArmazemDeChave = { ler: async () => Promise.reject(new Error('x')), gravar: async () => Promise.reject(new Error('x')), apagar: async () => Promise.reject(new Error('x')) };
    const alvo = new TokenLocal(quebrado, servidor().buscar);
    await alvo.receberDaUrl(fragmento(`#b=${BILHETE}`), { replaceState: () => {} });
    expect(alvo.tem()).toBe(true);
    await alvo.apagar();
    expect(alvo.tem()).toBe(false);
  });

  it('avisa quem ouve quando a chave entra ou sai', async () => {
    const s = servidor();
    const alvo = new TokenLocal(armazem().a, s.buscar);
    let vezes = 0;
    alvo.aoMudar(() => vezes++);
    await alvo.receberDaUrl(fragmento(`#b=${BILHETE}`), { replaceState: () => {} });
    const antes = vezes;
    await alvo.apagar();
    expect(antes).toBeGreaterThan(0);
    expect(vezes).toBe(antes + 1);
  });
});

describe('escritas da página', () => {
  it('assina o desafio do servidor: o cabeçalho é o vetor conhecido, e a chamada leva o resto do pedido', async () => {
    const { alvo, s } = await comChave();
    const res = await alvo.escrever(CAMINHO, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
    expect(res.status).toBe(200);
    expect(s.chamadas.map((c) => c.url.split('?')[0])).toEqual(['/api/token/desafio', '/api/permissions/p-1/decision']);
    expect(s.chamadas[0]!.url).toMatch(/^\/api\/token\/desafio\?n=[0-9a-f]{32}$/);
    const [, pedido] = s.chamadas;
    expect(pedido!.url).toBe(CAMINHO);
    expect(cabecalho(pedido!.init)).toBe(`${DESAFIO}.${CLIENTE_POST}`);
    expect(new Headers(pedido!.init.headers).get('content-type')).toBe('application/json');
    expect(pedido!.init.body).toBe('{"a":1}');
    expect(pedido!.init.method).toBe('POST');
  });

  it('cada escrita pede um desafio novo, com nonce novo, e a prova depende do método e do caminho', async () => {
    const { alvo, s } = await comChave();
    await alvo.escrever('/api/demo', { method: 'POST' });
    await alvo.escrever('/api/demo', { method: 'DELETE' });
    await alvo.escrever('/api/rooms/rename', { method: 'POST' });
    const desafios = s.chamadas.filter((c) => c.url.startsWith('/api/token/desafio'));
    expect(desafios).toHaveLength(3);
    expect(new Set(desafios.map((c) => c.url)).size).toBe(3);
    const provas = s.chamadas.filter((c) => !c.url.startsWith('/api/token/desafio')).map((c) => cabecalho(c.init));
    expect(new Set(provas).size).toBe(3);
  });

  it('o segredo e a chave não aparecem em nenhuma chamada: nem na URL, nem nos cabeçalhos, nem no corpo', async () => {
    const { alvo, s } = await comChave();
    await alvo.escrever('/api/demo', { method: 'POST', body: '{"enabled":true}' });
    await alvo.escrever('/api/social/ritmo', { method: 'POST', body: '{"ritmo":"calm"}' });
    for (const c of s.chamadas) {
      const bruto = JSON.stringify([c.url, [...new Headers(c.init.headers)], c.init.body]);
      expect(bruto).not.toContain(TOKEN);
      expect(bruto).not.toContain(CHAVE);
    }
  });

  it('sem chave a escrita nem sai da página: 401 com os passos para abrir autorizado', async () => {
    const s = servidor();
    const alvo = new TokenLocal(armazem().a, s.buscar);
    const res = await alvo.escrever('/api/permissions/p/decision', { method: 'POST', body: '{}' });
    expect(s.chamadas).toEqual([]);
    expect(res.status).toBe(401);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe(AVISO_SEM_TOKEN);
    expect(error).toContain('npm run abrir');
    expect(error).toContain('/escritorio');
  });

  it('um 401 e depois o certo (desafio perdido): tenta de novo com outro desafio e a chave fica', async () => {
    const respostas = [new Response('{}', { status: 401 }), new Response('{}', { status: 200 })];
    const s = servidor({ resto: () => respostas.shift()! });
    const { alvo } = await comChave(s);
    expect((await alvo.escrever('/api/demo', { method: 'POST' })).status).toBe(200);
    expect(s.chamadas.filter((c) => c.url.startsWith('/api/token/desafio'))).toHaveLength(2);
    expect(alvo.tem()).toBe(true);
  });

  it('dois 401 seguidos (o servidor não reconhece a chave) apagam a chave guardada e devolvem o aviso; as próximas escritas nem saem', async () => {
    const s = servidor({ resto: () => new Response('{}', { status: 401 }) });
    const { alvo, arm } = await comChave(s);
    const res = await alvo.escrever('/api/demo', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe(AVISO_TOKEN_RECUSADO);
    expect(arm.estado.chave).toBeNull();
    expect(alvo.tem()).toBe(false);
    const antes = s.chamadas.length;
    await alvo.escrever('/api/demo', { method: 'POST' });
    expect(s.chamadas).toHaveLength(antes);
  });

  it('outros erros do servidor (400, 403, 404, 500, 503) passam como vieram e não apagam a chave', async () => {
    for (const status of [400, 403, 404, 500, 503]) {
      const { alvo } = await comChave(servidor({ resto: () => new Response('{}', { status }) }));
      expect((await alvo.escrever('/api/demo', { method: 'POST' })).status).toBe(status);
      expect(alvo.tem()).toBe(true);
    }
  });

  it('servidor sem token (503 no desafio) devolve a resposta dele sem apagar a chave; desafio torto vira 502', async () => {
    const sem = await comChave(servidor({ desafio: () => new Response('{"error":"Sem token legível"}', { status: 503 }) }));
    const res = await sem.alvo.escrever('/api/demo', { method: 'POST' });
    expect(res.status).toBe(503);
    expect(sem.alvo.tem()).toBe(true);
    for (const corpo of ['lixo', '{}', '{"desafio":"curto"}', `{"desafio":"${'A'.repeat(32)}"}`]) {
      const { alvo, s } = await comChave(servidor({ desafio: () => new Response(corpo, { status: 200 }) }));
      expect((await alvo.escrever('/api/demo', { method: 'POST' })).status, corpo).toBe(502);
      expect(s.chamadas.every((c) => c.url.startsWith('/api/token/desafio'))).toBe(true);
      expect(alvo.tem()).toBe(true);
    }
  });

  it('uma conexão que cai propaga o erro, como o fetch faria (quem chama já trata), e a chave fica', async () => {
    let cai = false;
    const s = servidor();
    const alvo = new TokenLocal(armazem().a, async (url, init) => {
      if (cai) throw new TypeError('failed to fetch');
      return s.buscar(url, init);
    });
    await alvo.receberDaUrl(fragmento(`#b=${BILHETE}`), { replaceState: () => {} });
    cai = true;
    await expect(alvo.escrever('/api/demo', { method: 'POST' })).rejects.toThrow('failed to fetch');
    expect(alvo.tem()).toBe(true);
  });

  it('a página sem WebCrypto (contexto inseguro) fica sem chave, com o aviso', async () => {
    const s = servidor();
    const alvo = new TokenLocal(armazem().a, s.buscar, null);
    await alvo.receberDaUrl(fragmento(`#b=${BILHETE}`), { replaceState: () => {} });
    expect(s.chamadas).toEqual([]);
    expect((await alvo.escrever('/api/demo', { method: 'POST' })).status).toBe(401);
  });
});

