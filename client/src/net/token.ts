// Token local da página: chega pelo fragmento da URL (`#t=<64 hex>`, que o navegador não manda ao servidor), fica no
// localStorage (isolado por origem, porta incluída) e vai no cabeçalho de toda chamada que muda estado.
// Sem token, as escritas nem saem da página: respondem com o aviso dos passos.

export const TOKEN_CHAVE = 'expediente:token';
export const TOKEN_CABECALHO = 'X-Expediente-Token';
const TOKEN_FORMATO = /^[0-9a-f]{64}$/;
const FRAGMENTO = /^#t=(.*)$/;

export const PASSOS_PARA_AUTORIZAR = 'Abra o escritório pelo botão "Abrir o escritório" do painel do /escritorio no Claude Code, ou rode npm run abrir na pasta do Expediente.';
export const AVISO_SEM_TOKEN = `Esta página não tem o token local, então as ações que mudam algo estão bloqueadas. ${PASSOS_PARA_AUTORIZAR}`;
export const AVISO_TOKEN_RECUSADO = `O servidor recusou o token desta página (ele pode ter sido trocado). ${PASSOS_PARA_AUTORIZAR}`;

interface Armazem {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

type Buscar = (input: string, init?: RequestInit) => Promise<Response>;

function armazemDoNavegador(): Armazem | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const recusa = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'Content-Type': 'application/json' } });

export class TokenLocal {
  private ouvintes = new Set<() => void>();
  /** Sem armazenamento (janela privada, dados bloqueados) o token vale só até recarregar a página. */
  private emMemoria: string | null = null;

  constructor(
    private readonly armazem: Armazem | null = armazemDoNavegador(),
    private readonly buscar: Buscar = (input, init) => fetch(input, init),
  ) {}

  /** O token guardado, ou null se não há ou o formato não é de token. */
  atual(): string | null {
    let v: string | null = this.emMemoria;
    try {
      v = this.armazem?.getItem(TOKEN_CHAVE) ?? v;
    } catch {
      // armazenamento que lança: vale o da memória
    }
    return v !== null && TOKEN_FORMATO.test(v) ? v : null;
  }

  aoMudar(cb: () => void): void {
    this.ouvintes.add(cb);
  }

  /**
   * Guarda o token do fragmento `#t=` (formato inválido é ignorado e o token que já havia fica). Devolve se o
   * fragmento era o do token: quem chama o tira da barra de endereço.
   */
  receber(hash: string): boolean {
    const m = FRAGMENTO.exec(hash);
    if (!m) return false;
    const valor = m[1] ?? '';
    if (TOKEN_FORMATO.test(valor)) {
      this.emMemoria = valor;
      try {
        this.armazem?.setItem(TOKEN_CHAVE, valor);
      } catch {
        // fica só na memória
      }
      this.avisarMudanca();
    }
    return true;
  }

  apagar(): void {
    this.emMemoria = null;
    try {
      this.armazem?.removeItem(TOKEN_CHAVE);
    } catch {
      // nada a apagar
    }
    this.avisarMudanca();
  }

  /** Toda chamada que muda estado passa por aqui. 401 do servidor apaga o token guardado. */
  async escrever(input: string, init: RequestInit = {}): Promise<Response> {
    const token = this.atual();
    if (!token) return recusa(401, AVISO_SEM_TOKEN);
    const headers = new Headers(init.headers);
    headers.set(TOKEN_CABECALHO, token);
    const res = await this.buscar(input, { ...init, headers });
    if (res.status !== 401) return res;
    this.apagar();
    return recusa(401, AVISO_TOKEN_RECUSADO);
  }

  private avisarMudanca(): void {
    for (const cb of this.ouvintes) cb();
  }
}

export const tokenLocal = new TokenLocal();

/** Ao carregar: guarda o token do fragmento e tira o fragmento da barra de endereço. */
export function receberTokenDaUrl(loc: { hash: string; pathname: string; search: string }, historico: { replaceState(estado: unknown, titulo: string, url: string): void }, alvo: TokenLocal = tokenLocal): void {
  if (!alvo.receber(loc.hash)) return;
  historico.replaceState(null, '', `${loc.pathname}${loc.search}`);
}
