import { describe, expect, it } from 'vitest';
import { AVISO_SEM_TOKEN, AVISO_TOKEN_RECUSADO, receberTokenDaUrl, TOKEN_CABECALHO, TOKEN_CHAVE, TokenLocal } from './token';

const TOKEN = '5e17e11a'.repeat(8);
const OUTRO = 'ab'.repeat(32);

function armazem(inicial: Record<string, string> = {}) {
  const dados = new Map(Object.entries(inicial));
  return {
    dados,
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
  };
}

function cenario(inicial: Record<string, string> = {}, status = 200) {
  const guardado = armazem(inicial);
  const chamadas: Array<{ url: string; init: RequestInit }> = [];
  const alvo = new TokenLocal(guardado, async (url, init) => {
    chamadas.push({ url, init: init ?? {} });
    return new Response('{}', { status });
  });
  return { guardado, chamadas, alvo };
}

const cabecalho = (init: RequestInit) => new Headers(init.headers).get(TOKEN_CABECALHO);

describe('fragmento #t= da URL', () => {
  it('guarda o token e tira o fragmento da barra de endereço, mantendo caminho e consulta', () => {
    const c = cenario();
    const trocas: string[] = [];
    receberTokenDaUrl({ hash: `#t=${TOKEN}`, pathname: '/', search: '?mock=1' }, { replaceState: (_e, _t, url) => void trocas.push(url) }, c.alvo);
    expect(c.guardado.dados.get(TOKEN_CHAVE)).toBe(TOKEN);
    expect(c.alvo.atual()).toBe(TOKEN);
    expect(trocas).toEqual(['/?mock=1']);
  });

  it('formato inválido é ignorado (e o token que já havia fica), mas o fragmento sai da barra', () => {
    for (const hash of ['#t=', '#t=abc', `#t=${TOKEN.slice(1)}`, `#t=${TOKEN}0`, `#t=${TOKEN.toUpperCase()}`, `#t=${TOKEN}&x=1`, `#t=${'g'.repeat(64)}`]) {
      const c = cenario({ [TOKEN_CHAVE]: OUTRO });
      const trocas: string[] = [];
      receberTokenDaUrl({ hash, pathname: '/', search: '' }, { replaceState: (_e, _t, url) => void trocas.push(url) }, c.alvo);
      expect(c.alvo.atual(), hash).toBe(OUTRO);
      expect(trocas, hash).toEqual(['/']);
    }
  });

  it('fragmento que não é do token fica como está', () => {
    const c = cenario();
    const trocas: string[] = [];
    for (const hash of ['', '#', '#sala-2', `#x=1&t=${TOKEN}`, `t=${TOKEN}`]) receberTokenDaUrl({ hash, pathname: '/', search: '' }, { replaceState: (_e, _t, url) => void trocas.push(url) }, c.alvo);
    expect(trocas).toEqual([]);
    expect(c.alvo.atual()).toBeNull();
  });

  it('valor guardado fora do formato não é usado', () => {
    expect(cenario({ [TOKEN_CHAVE]: 'lixo' }).alvo.atual()).toBeNull();
  });

  it('sem armazenamento (ou que lança) o token vale na memória da página', () => {
    const quebrado = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); }, removeItem: () => { throw new Error('bloqueado'); } };
    for (const armaz of [null, quebrado]) {
      const alvo = new TokenLocal(armaz, async () => new Response('{}'));
      alvo.receber(`#t=${TOKEN}`);
      expect(alvo.atual()).toBe(TOKEN);
      alvo.apagar();
      expect(alvo.atual()).toBeNull();
    }
  });

  it('avisa quem ouve quando o token entra ou sai', () => {
    const c = cenario();
    let vezes = 0;
    c.alvo.aoMudar(() => vezes++);
    c.alvo.receber(`#t=${TOKEN}`);
    c.alvo.receber('#t=curto');
    c.alvo.apagar();
    expect(vezes).toBe(2);
  });
});

describe('escritas da página', () => {
  it('o cabeçalho vai em POST, PUT e DELETE, e o resto do pedido segue como veio', async () => {
    const c = cenario({ [TOKEN_CHAVE]: TOKEN });
    for (const method of ['POST', 'PUT', 'DELETE']) {
      const res = await c.alvo.escrever('/api/x', { method, headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' });
      expect(res.status).toBe(200);
    }
    expect(c.chamadas.map((x) => x.init.method)).toEqual(['POST', 'PUT', 'DELETE']);
    for (const { init } of c.chamadas) {
      expect(cabecalho(init)).toBe(TOKEN);
      expect(new Headers(init.headers).get('content-type')).toBe('application/json');
      expect(init.body).toBe('{"a":1}');
    }
  });

  it('sem token a escrita nem sai da página: 401 com os passos para abrir autorizado', async () => {
    const c = cenario();
    const res = await c.alvo.escrever('/api/permissions/p/decision', { method: 'POST', body: '{}' });
    expect(c.chamadas).toEqual([]);
    expect(res.status).toBe(401);
    const { error } = (await res.json()) as { error: string };
    expect(error).toBe(AVISO_SEM_TOKEN);
    expect(error).toContain('npm run abrir');
    expect(error).toContain('/escritorio');
  });

  it('401 do servidor apaga o token guardado e devolve o aviso; as próximas escritas nem saem', async () => {
    const c = cenario({ [TOKEN_CHAVE]: TOKEN }, 401);
    const res = await c.alvo.escrever('/api/demo', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe(AVISO_TOKEN_RECUSADO);
    expect(c.guardado.dados.has(TOKEN_CHAVE)).toBe(false);
    expect(c.alvo.atual()).toBeNull();
    await c.alvo.escrever('/api/demo', { method: 'POST' });
    expect(c.chamadas).toHaveLength(1);
  });

  it('outros erros do servidor (403, 503) não apagam o token', async () => {
    for (const status of [400, 403, 404, 500, 503]) {
      const c = cenario({ [TOKEN_CHAVE]: TOKEN }, status);
      expect((await c.alvo.escrever('/api/demo', { method: 'POST' })).status).toBe(status);
      expect(c.alvo.atual()).toBe(TOKEN);
    }
  });
});
