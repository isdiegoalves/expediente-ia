// Prova do token local da página. O segredo nunca fica guardado como texto nem viaja: ele chega uma vez, trocado por um bilhete
// de uso único que veio no fragmento da URL (`#b=<32 hex>`, que o navegador não manda ao servidor), vira uma chave HMAC que
// não pode ser exportada, vai para o IndexedDB e o texto é descartado. Cada escrita pede um desafio ao servidor e manda a
// assinatura dele, não o segredo. Sem chave, as escritas nem saem da página: respondem com o aviso dos passos.

export const TOKEN_CABECALHO = 'X-Expediente-Prova';

export const PASSOS_PARA_AUTORIZAR = 'Abra o escritório pelo botão "Abrir o escritório" do painel do /escritorio no Claude Code, ou rode npm run abrir na pasta do Expediente.';
export const AVISO_SEM_TOKEN = `Esta página não tem a chave do token local, então as ações que mudam algo estão bloqueadas. ${PASSOS_PARA_AUTORIZAR}`;
export const AVISO_TOKEN_RECUSADO = `O servidor recusou a prova desta página (o token pode ter sido trocado). ${PASSOS_PARA_AUTORIZAR}`;
const AVISO_DESAFIO = 'O servidor não respondeu direito ao pedir o desafio do token.';

const FRAGMENTO = /^#([tb])=(.*)$/;
const BILHETE_FORMATO = /^[0-9a-f]{32}$/;
const TOKEN_FORMATO = /^[0-9a-f]{64}$/;
const HMAC = { name: 'HMAC', hash: 'SHA-256' } as const;

/** Onde a chave (um `CryptoKey` não extraível) fica entre uma visita e outra. */
export interface ArmazemDeChave {
  ler(): Promise<CryptoKey | null>;
  gravar(chave: CryptoKey): Promise<void>;
  apagar(): Promise<void>;
}

type Buscar = (input: string, init?: RequestInit) => Promise<Response>;

const BASE_DE_DADOS = 'expediente-token';
const LOJA = 'chaves';
const ID_DA_CHAVE = 'token';

/** O IndexedDB guarda o `CryptoKey` como objeto: o script da página pode usá-lo para assinar, mas não consegue ler os bytes. */
export class ChaveNoIndexedDb implements ArmazemDeChave {
  private banco(): Promise<IDBDatabase> {
    return new Promise((ok, fail) => {
      const pedido = indexedDB.open(BASE_DE_DADOS, 1);
      pedido.onupgradeneeded = () => pedido.result.createObjectStore(LOJA);
      pedido.onsuccess = () => ok(pedido.result);
      pedido.onerror = () => fail(pedido.error);
    });
  }

  private async operar<T>(modo: IDBTransactionMode, fn: (loja: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const banco = await this.banco();
    try {
      return await new Promise<T>((ok, fail) => {
        const pedido = fn(banco.transaction(LOJA, modo).objectStore(LOJA));
        pedido.onsuccess = () => ok(pedido.result);
        pedido.onerror = () => fail(pedido.error);
      });
    } finally {
      banco.close();
    }
  }

  async ler(): Promise<CryptoKey | null> {
    const v = await this.operar('readonly', (loja) => loja.get(ID_DA_CHAVE) as IDBRequest<unknown>);
    return typeof CryptoKey !== 'undefined' && v instanceof CryptoKey ? v : null;
  }

  async gravar(chave: CryptoKey): Promise<void> {
    await this.operar('readwrite', (loja) => loja.put(chave, ID_DA_CHAVE));
  }

  async apagar(): Promise<void> {
    await this.operar('readwrite', (loja) => loja.delete(ID_DA_CHAVE));
  }
}

function armazemDoNavegador(): ArmazemDeChave | null {
  try {
    return typeof indexedDB === 'undefined' ? null : new ChaveNoIndexedDb();
  } catch {
    return null;
  }
}

const recusa = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });

const hex = (bytes: ArrayBuffer | Uint8Array) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

const doHex = (texto: string) => Uint8Array.from(texto.match(/../g) ?? [], (par) => Number.parseInt(par, 16));

export class TokenLocal {
  private ouvintes = new Set<() => void>();
  private chave: CryptoKey | null = null;
  private carga: Promise<void> | null = null;
  /** A leitura da chave guardada e a troca do bilhete da URL, se havia, já terminaram: antes disso não há o que avisar. */
  carregado = false;

  constructor(
    private readonly armazem: ArmazemDeChave | null = armazemDoNavegador(),
    private readonly buscar: Buscar = (input, init) => fetch(input, init),
    private readonly cripto: Crypto | null = globalThis.crypto ?? null,
  ) {}

  /** Lê a chave guardada, uma vez. */
  iniciar(): Promise<void> {
    this.carga ??= (async () => {
      try {
        this.chave = (await this.armazem?.ler()) ?? null;
      } catch {
        // armazenamento que falha (janela privada, dados bloqueados): a chave vale só até recarregar a página
      }
    })();
    return this.carga;
  }

  /** Esta página tem a chave. */
  tem(): boolean {
    return this.chave !== null;
  }

  aoMudar(cb: () => void): void {
    this.ouvintes.add(cb);
  }

  /**
   * Ao carregar: tira da barra de endereço o fragmento `#b=` (e o `#t=` antigo, que levava o segredo; esse nunca é usado) e, se
   * for um bilhete, troca por uma chave. Qualquer falha deixa a página sem chave, com o aviso.
   */
  async receberDaUrl(loc: { hash: string; pathname: string; search: string }, historico: { replaceState(estado: unknown, titulo: string, url: string): void }): Promise<void> {
    await this.iniciar();
    try {
      const m = FRAGMENTO.exec(loc.hash);
      if (!m) return;
      historico.replaceState(null, '', `${loc.pathname}${loc.search}`);
      if (m[1] === 'b' && BILHETE_FORMATO.test(m[2] ?? '')) await this.trocar(m[2] as string);
    } finally {
      this.carregado = true;
      this.avisarMudanca();
    }
  }

  private async trocar(bilhete: string): Promise<void> {
    if (!this.cripto?.subtle) return;
    try {
      const res = await this.buscar('/api/token/troca', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bilhete }) });
      if (!res.ok) return;
      const texto = ((await res.json()) as { token?: unknown }).token;
      if (typeof texto !== 'string' || !TOKEN_FORMATO.test(texto)) return;
      const bytes = doHex(texto);
      const chave = await this.cripto.subtle.importKey('raw', bytes, HMAC, false, ['sign']);
      bytes.fill(0);
      this.chave = chave;
      try {
        await this.armazem?.gravar(chave);
      } catch {
        // fica só na memória
      }
    } catch {
      // sem conexão ou resposta torta: segue sem chave
    }
  }

  async apagar(): Promise<void> {
    this.chave = null;
    this.avisarMudanca();
    try {
      await this.armazem?.apagar();
    } catch {
      // nada a apagar
    }
  }

  /** Toda chamada que muda estado passa por aqui. Dois 401 seguidos (o servidor não reconhece mais a chave) apagam a chave guardada. */
  async escrever(input: string, init: RequestInit = {}): Promise<Response> {
    await this.iniciar();
    const cripto = this.cripto;
    if (!this.chave || !cripto?.subtle) return recusa(401, AVISO_SEM_TOKEN);
    const metodo = (init.method ?? 'GET').toUpperCase();
    const alvo = new URL(input, 'http://x');
    const caminho = `${alvo.pathname}${alvo.search}`;
    for (let tentativa = 0; tentativa < 2; tentativa++) {
      const n = hex(cripto.getRandomValues(new Uint8Array(16)));
      const desafio = await this.buscar(`/api/token/desafio?n=${n}`);
      if (!desafio.ok) return desafio;
      const id = ((await desafio.json().catch(() => ({}))) as { desafio?: unknown }).desafio;
      if (typeof id !== 'string' || !BILHETE_FORMATO.test(id)) return recusa(502, AVISO_DESAFIO);
      const assinatura = await cripto.subtle.sign(HMAC.name, this.chave, new TextEncoder().encode(`cliente\n${id}\n${metodo}\n${caminho}`));
      const headers = new Headers(init.headers);
      headers.set(TOKEN_CABECALHO, `${id}.${hex(assinatura)}`);
      const res = await this.buscar(input, { ...init, headers });
      if (res.status !== 401) return res;
    }
    await this.apagar();
    return recusa(401, AVISO_TOKEN_RECUSADO);
  }

  private avisarMudanca(): void {
    for (const cb of this.ouvintes) cb();
  }
}

export const tokenLocal = new TokenLocal();

/** Ao carregar a página: guarda a chave que o bilhete da URL traz e tira o fragmento da barra de endereço. */
export function receberTokenDaUrl(loc: { hash: string; pathname: string; search: string }, historico: { replaceState(estado: unknown, titulo: string, url: string): void }): Promise<void> {
  return tokenLocal.receberDaUrl(loc, historico);
}
