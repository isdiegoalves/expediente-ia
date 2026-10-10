// Carteiras dos personagens (moedinhas fictícias 🪙). Quem chega ao escritório já entra com um
// saldo; ganha mais a cada tarefa concluída e perde ou ganha nas apostas com os colegas.
//
// O livro fica no servidor (<dataDir>/social.json) e chega a todas as abas pelo snapshot; no modo
// mock e no timelapse o navegador mantém um livro só em memória.

/** Saldo de quem chega ao escritório. */
export const START_COINS: Readonly<Record<'main' | 'sub', number>> = { main: 100, sub: 30 };
/** Item da lista de tarefas concluído. */
export const TASK_REWARD = 10;
/** Subagente entregou o resultado ao agente que o chamou (a tarefa dele). */
export const DELIVERY_REWARD = 15;
/** Pedido do usuário atendido (fim de turno). */
export const TURN_REWARD = 5;

const LEDGER_MAX = 12;
const PAID_MAX = 300;
/** Carteiras de agentes que não aparecem há mais que isso são esquecidas. */
const FORGET_MS = 3 * 24 * 3_600_000;
const MAX_WALLETS = 400;

export interface LedgerEntry {
  at: number;
  delta: number;
  icon: string;
  text: string;
}

export interface WalletEntry {
  name: string;
  coins: number;
  /** Total ganho trabalhando (saldo inicial, tarefas, entregas, pedidos). */
  earned: number;
  wins: number;
  losses: number;
  /** Retrospecto por adversário (id): [vitórias, derrotas]. */
  vs: Record<string, [number, number]>;
  /** Tarefas já pagas ("id|título"). */
  paid: string[];
  /** Extrato: movimentações mais recentes primeiro. */
  ledger: LedgerEntry[];
  createdAt: number;
  seenAt: number;
}

/** O que o snapshot leva de cada carteira (sem as tarefas pagas nem as datas internas). */
export type CarteiraInfo = Pick<WalletEntry, 'coins' | 'earned' | 'wins' | 'losses' | 'vs' | 'ledger'>;

/** O mínimo de AgentInfo que a carteira usa. */
export interface WalletAgent {
  id: string;
  name: string;
  kind: 'main' | 'sub';
  tasks: readonly { id: string; title: string; status: string }[];
}

function taskKey(t: { id: string; title: string }): string {
  return `${t.id}|${t.title}`;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readVs(v: unknown): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  if (!v || typeof v !== 'object') return out;
  for (const [id, r] of Object.entries(v as Record<string, unknown>)) {
    if (Array.isArray(r) && r.length === 2) out[id] = [Math.max(0, Math.floor(num(r[0], 0))), Math.max(0, Math.floor(num(r[1], 0)))];
  }
  return out;
}

function readLedger(v: unknown): LedgerEntry[] {
  if (!Array.isArray(v)) return [];
  const out: LedgerEntry[] = [];
  for (const e of v.slice(0, LEDGER_MAX)) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (typeof r.text !== 'string' || typeof r.icon !== 'string') continue;
    out.push({ at: num(r.at, 0), delta: Math.floor(num(r.delta, 0)), icon: r.icon, text: r.text });
  }
  return out;
}

/** Uma carteira lida do arquivo, ou null se o saldo estiver fora do formato. */
function readEntry(id: string, raw: unknown): WalletEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const w = raw as Record<string, unknown>;
  if (typeof w.coins !== 'number' || !Number.isFinite(w.coins)) return null;
  const coins = Math.max(0, Math.floor(w.coins));
  return {
    name: typeof w.name === 'string' ? w.name : id,
    coins,
    earned: num(w.earned, coins),
    wins: Math.max(0, Math.floor(num(w.wins, 0))),
    losses: Math.max(0, Math.floor(num(w.losses, 0))),
    vs: readVs(w.vs),
    paid: Array.isArray(w.paid) ? w.paid.filter((p): p is string => typeof p === 'string').slice(-PAID_MAX) : [],
    ledger: readLedger(w.ledger),
    createdAt: num(w.createdAt, 0),
    seenAt: num(w.seenAt, 0),
  };
}

export class Wallets {
  private map = new Map<string, WalletEntry>();
  private dirty = false;

  /** `saved`: o objeto `carteiras` do arquivo; o que estiver fora do formato fica de fora. */
  constructor(saved?: unknown) {
    if (!saved || typeof saved !== 'object') return;
    for (const [id, raw] of Object.entries(saved as Record<string, unknown>)) {
      const w = readEntry(id, raw);
      if (w) this.map.set(id, w);
    }
  }

  get(id: string): WalletEntry | undefined {
    return this.map.get(id);
  }

  coins(id: string): number {
    return this.map.get(id)?.coins ?? 0;
  }

  /** O que o snapshot mostra da carteira. */
  info(id: string): CarteiraInfo | undefined {
    const w = this.map.get(id);
    if (!w) return undefined;
    return { coins: w.coins, earned: w.earned, wins: w.wins, losses: w.losses, vs: Object.fromEntries(Object.entries(w.vs).map(([k, r]) => [k, [r[0], r[1]]])), ledger: w.ledger.map((e) => ({ ...e })) };
  }

  /**
   * Garante a carteira do agente. Na primeira vez: saldo inicial e as tarefas que já estavam
   * concluídas pagas em silêncio (quem já trabalhou antes de o escritório abrir não perde o que fez).
   */
  ensure(a: WalletAgent, now: number): { entry: WalletEntry; created: boolean } {
    let w = this.map.get(a.id);
    if (w) {
      if (w.name !== a.name) w.name = a.name;
      if (now - w.seenAt > 60_000) {
        w.seenAt = now;
        this.dirty = true;
      }
      return { entry: w, created: false };
    }
    const start = START_COINS[a.kind] ?? START_COINS.main;
    w = { name: a.name, coins: start, earned: start, wins: 0, losses: 0, vs: {}, paid: [], ledger: [], createdAt: now, seenAt: now };
    this.map.set(a.id, w);
    this.log(w, { at: now, delta: start, icon: '🏢', text: 'Chegou ao escritório' });
    const done = a.tasks.filter((t) => t.status === 'completed');
    if (done.length) {
      for (const t of done) w.paid.push(taskKey(t));
      const v = done.length * TASK_REWARD;
      w.coins += v;
      w.earned += v;
      this.log(w, { at: now, delta: v, icon: '✅', text: done.length === 1 ? '1 tarefa já concluída' : `${done.length} tarefas já concluídas` });
    }
    this.dirty = true;
    return { entry: w, created: true };
  }

  /** Paga as tarefas concluídas que ainda não foram pagas. Retorna quanto pagou agora. */
  payTasks(a: WalletAgent, now: number): number {
    const w = this.map.get(a.id);
    if (!w) return 0;
    let total = 0;
    for (const t of a.tasks) {
      if (t.status !== 'completed') continue;
      const k = taskKey(t);
      if (w.paid.includes(k)) continue;
      w.paid.push(k);
      if (w.paid.length > PAID_MAX) w.paid.splice(0, w.paid.length - PAID_MAX);
      w.coins += TASK_REWARD;
      w.earned += TASK_REWARD;
      total += TASK_REWARD;
      this.log(w, { at: now, delta: TASK_REWARD, icon: '✅', text: `Tarefa concluída: ${t.title}` });
    }
    if (total) this.dirty = true;
    return total;
  }

  /** Crédito por trabalho (pedido atendido, entrega de subagente). */
  credit(id: string, amount: number, icon: string, text: string, now: number): number {
    const w = this.map.get(id);
    if (!w || amount <= 0) return 0;
    w.coins += amount;
    w.earned += amount;
    this.log(w, { at: now, delta: amount, icon, text });
    this.dirty = true;
    return amount;
  }

  /**
   * Aposta paga: tira até `amount` de quem perdeu (nunca deixa negativo) e dá a quem ganhou.
   * Retorna o valor que de fato mudou de mãos.
   */
  transfer(fromId: string, toId: string, amount: number, icon: string, what: string, now: number): number {
    const from = this.map.get(fromId);
    const to = this.map.get(toId);
    if (!from || !to || fromId === toId) return 0;
    const v = Math.max(0, Math.min(Math.floor(amount), from.coins));
    if (!v) return 0;
    from.coins -= v;
    to.coins += v;
    this.log(from, { at: now, delta: -v, icon, text: `Perdeu ${what} para ${to.name}` });
    this.log(to, { at: now, delta: v, icon, text: `Ganhou ${what} de ${from.name}` });
    this.dirty = true;
    return v;
  }

  /** Placar de uma partida/aposta (vale também sem dinheiro em jogo). */
  recordMatch(winnerId: string, loserId: string): void {
    const w = this.map.get(winnerId);
    const l = this.map.get(loserId);
    if (!w || !l) return;
    w.wins++;
    l.losses++;
    (w.vs[loserId] ??= [0, 0])[0]++;
    (l.vs[winnerId] ??= [0, 0])[1]++;
    this.dirty = true;
  }

  /** Esquece carteiras de quem não aparece há dias (e limita o total). */
  prune(now: number): void {
    for (const [id, w] of this.map) {
      if (now - w.seenAt <= FORGET_MS) continue;
      this.map.delete(id);
      this.dirty = true;
    }
    if (this.map.size <= MAX_WALLETS) return;
    const old = [...this.map.entries()].sort((a, b) => a[1].seenAt - b[1].seenAt);
    for (const [id] of old.slice(0, this.map.size - MAX_WALLETS)) this.map.delete(id);
    this.dirty = true;
  }

  /** Algo mudou desde a última chamada (quem grava o arquivo pergunta isso). */
  takeDirty(): boolean {
    const d = this.dirty;
    this.dirty = false;
    return d;
  }

  /** O objeto `carteiras` do arquivo. */
  toJSON(): Record<string, WalletEntry> {
    return Object.fromEntries(this.map);
  }

  private log(w: WalletEntry, e: LedgerEntry): void {
    w.ledger.unshift(e);
    if (w.ledger.length > LEDGER_MAX) w.ledger.length = LEDGER_MAX;
  }
}
