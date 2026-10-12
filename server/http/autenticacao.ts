// Autenticação das escritas: desafio e prova (HMAC) no lugar do token em claro, e o bilhete de uso único que leva o
// segredo ao navegador. Quem cobra é o guard (guard.ts); aqui ficam o estado em memória e as três rotas /api/token/*.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { aleatorioHex, iguais, NONCE_FORMATO, provaDoCliente, provaDoServidor, type TokenLido } from '../token';

export const PROVA_CABECALHO = 'x-expediente-prova';
export const DESAFIO_VALIDADE_MS = 60_000;
export const BILHETE_VALIDADE_MS = 60_000;
/** Teto de desafios e de bilhetes vivos: passando dele, os mais antigos saem. */
export const MAX_DESAFIOS = 1_000;
export const MAX_BILHETES = 64;
const MAX_CORPO = 1_024;
const PROVA_FORMATO = /^([0-9a-f]{32})\.([0-9a-f]{64})$/;

export type RotaDeToken = 'desafio' | 'bilhete' | 'troca';
const ROTAS: Record<string, RotaDeToken> = { '/api/token/desafio': 'desafio', '/api/token/bilhete': 'bilhete', '/api/token/troca': 'troca' };

/** Códigos de uso único que vencem: só em memória, nunca vão para disco. */
class Validades {
  private readonly itens = new Map<string, number>();

  constructor(
    private readonly max: number,
    private readonly validadeMs: number,
    private readonly now: () => number,
  ) {}

  emitir(): string {
    const agora = this.now();
    for (const [id, venceEm] of this.itens) if (venceEm < agora) this.itens.delete(id);
    while (this.itens.size >= this.max) this.itens.delete(this.itens.keys().next().value as string);
    const id = aleatorioHex();
    this.itens.set(id, agora + this.validadeMs);
    return id;
  }

  /** Uso único: o código some ao ser conferido, valendo ou não. */
  consumir(id: string): boolean {
    const venceEm = this.itens.get(id);
    this.itens.delete(id);
    return venceEm !== undefined && this.now() <= venceEm;
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
  });
  res.end(data);
}

function lerCorpo(req: IncomingMessage): Promise<unknown> {
  return new Promise((ok, fail) => {
    const pedacos: Buffer[] = [];
    let tamanho = 0;
    req.on('data', (c: Buffer) => {
      tamanho += c.length;
      if (tamanho <= MAX_CORPO) pedacos.push(c);
    });
    req.on('end', () => {
      if (tamanho > MAX_CORPO) return fail(new Error('corpo grande demais'));
      try {
        ok(JSON.parse(Buffer.concat(pedacos).toString('utf8')));
      } catch (err) {
        fail(err);
      }
    });
    req.on('error', fail);
  });
}

export class Autenticacao {
  private readonly desafios: Validades;
  private readonly bilhetes: Validades;

  constructor(
    private readonly lerToken: () => TokenLido,
    now: () => number = Date.now,
  ) {
    this.desafios = new Validades(MAX_DESAFIOS, DESAFIO_VALIDADE_MS, now);
    this.bilhetes = new Validades(MAX_BILHETES, BILHETE_VALIDADE_MS, now);
  }

  /** O token do arquivo, lido de novo a cada chamada. */
  token(): TokenLido {
    return this.lerToken();
  }

  rotaDe(path: string): RotaDeToken | undefined {
    return Object.hasOwn(ROTAS, path) ? ROTAS[path] : undefined;
  }

  emitirDesafio(): string {
    return this.desafios.emitir();
  }

  /** A prova de uma escrita: `<desafio>.<hex>`, de um desafio vigente que esta conferência consome. */
  confere(cabecalho: string | string[] | undefined, metodo: string, caminho: string, chave: Buffer): boolean {
    const m = typeof cabecalho === 'string' ? PROVA_FORMATO.exec(cabecalho) : null;
    if (!m) return false;
    if (!this.desafios.consumir(m[1])) return false;
    return iguais(m[2], provaDoCliente(chave, m[1], metodo, caminho));
  }

  /** `GET /api/token/desafio?n=<nonce do cliente>`: o desafio do servidor e a prova de que ele tem o token. Sem prova do cliente. */
  desafio(res: ServerResponse, url: URL): void {
    const lido = this.lerToken();
    if (!lido.ok) return json(res, 503, { error: `Sem token legível: ${lido.motivo}.` });
    const n = url.searchParams.get('n') ?? '';
    if (!NONCE_FORMATO.test(n)) return json(res, 400, { error: 'esperado ?n= com 32 hexadecimais minúsculos' });
    json(res, 200, { desafio: this.emitirDesafio(), prova: provaDoServidor(lido.chave, n) });
  }

  /** `POST /api/token/bilhete` (o guard já conferiu a prova) e `POST /api/token/troca` (o bilhete é a credencial). */
  tratar(rota: 'bilhete' | 'troca', req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      req.resume();
      return json(res, 405, { error: 'método não permitido' });
    }
    const lido = this.lerToken();
    if (!lido.ok) {
      req.resume();
      return json(res, 503, { error: `Sem token legível: ${lido.motivo}.` });
    }
    if (rota === 'bilhete') {
      req.resume();
      return json(res, 200, { bilhete: this.bilhetes.emitir() });
    }
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'none' && site !== 'same-origin') {
      req.resume();
      return json(res, 403, { error: 'pedido de outra origem' });
    }
    lerCorpo(req).then(
      (corpo) => {
        const bilhete = (corpo as { bilhete?: unknown } | null)?.bilhete;
        if (typeof bilhete !== 'string' || !NONCE_FORMATO.test(bilhete)) return json(res, 400, { error: 'esperado {bilhete} com 32 hexadecimais minúsculos' });
        if (!this.bilhetes.consumir(bilhete)) return json(res, 401, { error: 'bilhete desconhecido, vencido ou já usado' });
        json(res, 200, { token: lido.token });
      },
      () => json(res, 400, { error: 'JSON inválido' }),
    );
  }
}
