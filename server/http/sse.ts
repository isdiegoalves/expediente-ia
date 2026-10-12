// Transmissão em tempo real (Server-Sent Events) em GET /api/stream.
// Eventos nomeados: snapshot | feed | notice (o `data` é o JSON do protocolo em shared/types.ts) e tema ({chave}).
// Snapshots saem com throttle (~200 ms); feed e avisos vão em lote logo depois do snapshot.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OfficeSnapshot } from '../../shared/types';
import type { Office } from '../model/office';
import { isLoopbackHost } from './guard';

/** Cliente lento demais (buffer acumulado acima disto) é desconectado; o EventSource reconecta. */
const MAX_BUFFERED = 8 * 1024 * 1024;

export class Hub {
  private clients = new Set<ServerResponse>();
  /** Clientes que abriram a página por um Host local (os únicos que podem responder pedidos de permissão). */
  /** Os streams de Host local e o pedido de cada um: `conta` é consultado na hora de contar, não só na conexão. */
  private local = new WeakMap<ServerResponse, IncomingMessage>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private lastFlush = 0;
  private unsubscribe: (() => void) | null = null;
  private snapshotCbs = new Set<(snap: OfficeSnapshot) => void>();
  /** Último aviso de tema: quem conecta depois o recebe, e a aba que perdeu a troca percebe que está desatualizada. */
  private frameTema: string | null = null;
  private readonly throttleMs: number;
  private readonly pingMs: number;

  /** Quais streams contam como página aberta, a cada contagem (padrão: todos). Em produção: os que provaram com o token de agora. */
  private readonly conta: (req: IncomingMessage) => boolean;

  constructor(
    private readonly office: Office,
    opts: { throttleMs?: number; pingMs?: number; conta?: (req: IncomingMessage) => boolean } = {},
  ) {
    this.conta = opts.conta ?? (() => true);
    this.throttleMs = opts.throttleMs ?? 200;
    this.pingMs = opts.pingMs ?? 15_000;
  }

  start(): void {
    this.unsubscribe = this.office.onChange(() => this.schedule());
    this.pinger = setInterval(() => this.writeAll(': ping\n\n'), this.pingMs);
    this.pinger.unref?.();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    if (this.pinger) clearInterval(this.pinger);
    this.timer = null;
    this.pinger = null;
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }

  /** Avisado a cada snapshot novo transmitido (ex.: o gravador da linha do tempo). */
  onSnapshot(cb: (snap: OfficeSnapshot) => void): () => void {
    this.snapshotCbs.add(cb);
    return () => void this.snapshotCbs.delete(cb);
  }

  /** Páginas conectadas por um Host local (localhost/127.x) e que `conta` aceita (em produção, as que provaram o token): quem pode responder pelo escritório. */
  get localSize(): number {
    let n = 0;
    for (const c of this.clients) {
      const req = this.local.get(c);
      if (req && !c.destroyed && !c.writableEnded && this.conta(req)) n++;
    }
    return n;
  }

  /** Conecta um cliente: snapshot completo + últimos 50 itens do feed, depois o fluxo ao vivo. */
  attach(req: IncomingMessage, res: ServerResponse): void {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const snapshot = this.current();
    res.write('retry: 2000\n\n');
    res.write(frame('snapshot', snapshot));
    res.write(frame('feed', this.office.recentFeed(50)));
    if (this.frameTema) res.write(this.frameTema);
    this.clients.add(res);
    if (isLoopbackHost(req.headers.host)) this.local.set(res, req);
    const drop = () => this.clients.delete(res);
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
  }

  /** O tema ativo mudou (ou é este, na partida): `chave` identifica o estado dele (ver chaveDoTema). */
  avisarTema(chave: string): void {
    this.frameTema = frame('tema', { chave });
    this.writeAll(this.frameTema);
  }

  /** Fecha a revisão agora e transmite o que houver. Devolve o snapshot atual. */
  flush(): OfficeSnapshot {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastFlush = Date.now();
    const r = this.office.commit();
    if (r.changed) {
      this.writeAll(frame('snapshot', r.snapshot));
      for (const cb of this.snapshotCbs) {
        try {
          cb(r.snapshot);
        } catch {
          // quem escuta não atrapalha a transmissão
        }
      }
    }
    if (r.feed.length) this.writeAll(frame('feed', r.feed));
    for (const n of r.notices) this.writeAll(frame('notice', n));
    return r.snapshot;
  }

  /** Snapshot atual (depois de transmitir o que estiver pendente), com `serverTime` de agora. */
  current(): OfficeSnapshot {
    return { ...this.flush(), serverTime: Date.now() };
  }

  private schedule(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastFlush + this.throttleMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
    this.timer.unref?.();
  }

  private writeAll(chunk: string): void {
    for (const c of this.clients) {
      if (c.destroyed || c.writableEnded) {
        this.clients.delete(c);
        continue;
      }
      if (c.writableLength > MAX_BUFFERED) {
        this.clients.delete(c);
        c.destroy();
        continue;
      }
      c.write(chunk);
    }
  }
}

export function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
