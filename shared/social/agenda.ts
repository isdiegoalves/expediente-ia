// Agenda das rodas: quem entra em que roda, quando e com que resultado, e o livro das carteiras.
// Roda no servidor, que publica as rodas e as carteiras no snapshot; o navegador só anima o que
// recebe. Sem servidor (modo mock, timelapse), o navegador roda a mesma agenda em memória.
//
// Cada sorteio sai de mulberry32(hash da semente + o que se sorteia), nunca de um gerador com
// estado: a mesma semente, com o mesmo relógio e os mesmos agentes, dá as mesmas rodas.
import { MAX_INDIVIDUAIS } from '../equipes';
import { foregroundWaiting, shellWaitSince } from '../shell';
import { hash32, mulberry32 } from '../hash';
import type { AgentInfo, RodaAgendada, SocialSnapshot } from '../types';
import { DELIVERY_REWARD, TURN_REWARD, Wallets, type CarteiraInfo } from './carteiras';
import { bondBetween, hasTrait, personaFor, type Persona } from './persona';
import { betFor, KINDS, MATCH_WHAT, partnerScore, pickGesture, pickKind, pickProgram, rpsResult, SENTADO_MS, TARGET, winChance, type GatherKind, type Gesture, type Ritmo } from './regras';

/** Quem espera um shell só sai da mesa depois disto (antes, pipoca na mesa). */
export const SHELL_SOCIAL_MIN_MS = 40_000;
/** Ocioso há mais que isso: cochila na mesa e para de passear. */
export const LONG_IDLE_MS = 10 * 60_000;
/** Tempo previsto para todos chegarem ao lugar da roda. */
export const CAMINHADA_MS = 15_000;
/** Comemoração e despedida depois da última batida de cada roda. */
export const FINAL_MS: Readonly<Record<GatherKind, number>> = { tv: 1_400, kitchen: 900, talk: 900, mirror: 1_600, videogame: 3_400, arcade: 3_400, pingpong: 3_400, rps: 2_900 };

/** Quem não puxou roda foi passear sozinho: a próxima vontade vem depois do passeio e de outro tempo na mesa. */
const PASSEIO_MS: readonly [number, number] = [6_000, 15_000];
/** Roda com menos tempo que isso pela frente não aceita mais ninguém. */
const ENTRADA_MIN_MS = 10_000;
/** Rodas que dividem o mesmo lugar e quantas cabem ao mesmo tempo. */
const LUGAR: Readonly<Record<GatherKind, string>> = { tv: 'tv', videogame: 'tv', arcade: 'fliperama', pingpong: 'mesa', kitchen: 'copa', talk: 'conversa', rps: 'conversa', mirror: 'espelho' };
const VAGAS: Readonly<Record<string, number>> = { tv: 1, fliperama: 1, mesa: 1, copa: 2, conversa: 3, espelho: 2 };

export type AgenteSocial = Pick<AgentInfo, 'id' | 'name' | 'kind' | 'roomId' | 'seed' | 'status' | 'statusSince' | 'shells' | 'tasks' | 'activity' | 'title'>;

export function isLongIdle(status: AgentInfo['status'], statusSince: number, now: number): boolean {
  return status === 'idle' && now - statusSince > LONG_IDLE_MS;
}

/** Pode entrar numa roda: ocioso, ou esperando um shell há SHELL_SOCIAL_MIN_MS. */
export function disponivel(a: AgenteSocial, agora: number): { shell: boolean; sonolento: boolean } | null {
  if (a.status === 'idle' || (a.status === 'done' && a.kind === 'main')) return { shell: false, sonolento: isLongIdle(a.status, a.statusSince, agora) };
  const shell = a.status === 'shell' || (a.status === 'working' && foregroundWaiting(a.shells, agora));
  if (shell && agora - shellWaitSince(a) >= SHELL_SOCIAL_MIN_MS) return { shell: true, sonolento: false };
  return null;
}

/**
 * Salas com mais subagentes em atividade do que os MAX_INDIVIDUAIS que viram personagem. Quais viram, cada aba
 * decide pela ordem em que os viu chegar; daqui não dá para saber, então nenhum subagente da sala é convidado.
 */
function salasCheias(presentes: readonly AgenteSocial[]): Set<string> {
  const porSala = new Map<string, number>();
  for (const a of presentes) if (a.kind === 'sub' && a.status !== 'done') porSala.set(a.roomId, (porSala.get(a.roomId) ?? 0) + 1);
  return new Set([...porSala].filter(([, n]) => n > MAX_INDIVIDUAIS).map(([sala]) => sala));
}

export function sorteio(semente: number, ...partes: (string | number)[]): () => number {
  return mulberry32(hash32(`${semente}|${partes.join('|')}`));
}

function entre(rng: () => number, [a, b]: readonly [number, number]): number {
  return a + rng() * (b - a);
}

/** Quanto a roda dura depois que todos chegam (sem a comemoração final). */
function duracao(r: RodaAgendada, rng: () => number): number {
  switch (r.tipo) {
    case 'tv':
      return entre(rng, [30_000, 65_000]);
    case 'kitchen':
      return entre(rng, [24_000, 45_000]);
    case 'talk':
      return entre(rng, [10_000, 18_000]);
    case 'mirror':
      return entre(rng, [6_000, 11_000]);
    case 'pingpong':
      return 2_400 + (r.pontos?.length ?? 0) * 3_000;
    case 'videogame':
    case 'arcade':
      return (r.pontos?.length ?? 0) * 10_000;
    case 'rps': {
      let ms = 600;
      let vitorias = 0;
      for (const [a, b] of r.jogadas ?? []) {
        ms += 3 * 540 + 1_500;
        if (rpsResult(a, b) === 0) ms += 1_400;
        else if (++vitorias === 1 && r.revanche) ms += 3_400;
      }
      return ms;
    }
  }
}

/**
 * Monta uma roda com os participantes já escolhidos (anfitrião primeiro; nas partidas, os dois
 * primeiros jogam): aposta, programa da TV, o resultado de cada ponto ou jogada e a hora do fim.
 */
export function montarRoda(
  semente: number,
  id: string,
  tipo: GatherKind,
  quem: readonly Pick<AgenteSocial, 'id' | 'seed'>[],
  inicio: number,
  saldo: (id: string) => number,
): RodaAgendada {
  const rng = sorteio(semente, 'roda', id);
  const [a, b] = quem;
  const pa = personaFor(a.seed);
  const r: RodaAgendada = { id, tipo, inicio, fim: inicio, participantes: quem.map((q) => q.id), aposta: 0 };
  if (tipo === 'tv') r.programa = pickProgram(rng, pa);
  if (KINDS[tipo].match && b) {
    const pb = personaFor(b.seed);
    r.aposta = betFor(tipo, pa, pb, saldo(a.id), saldo(b.id), bondBetween(a.seed, b.seed), rng);
    const alvo = TARGET[tipo];
    if (alvo) {
      const pontos: (0 | 1)[] = [];
      const placar = [0, 0];
      while (Math.max(placar[0], placar[1]) < alvo) {
        const p = rng() < winChance(pa.skill, pb.skill) ? 0 : 1;
        placar[p]++;
        pontos.push(p);
      }
      r.pontos = pontos;
    } else {
      // jokenpô: até 3 empates seguidos desistem; quem perde e gosta de competir ou apostar pede revanche
      const jogadas: [Gesture, Gesture][] = [];
      let empates = 0;
      let revanche = false;
      for (let guarda = 0; guarda < 12; guarda++) {
        const j: [Gesture, Gesture] = [pickGesture(rng, pa), pickGesture(rng, pb)];
        jogadas.push(j);
        const res = rpsResult(j[0], j[1]);
        if (res === 0) {
          if (++empates >= 3) break;
          continue;
        }
        if (revanche) break;
        const [vence, perde] = res === 1 ? [a, b] : [b, a];
        const pp = personaFor(perde.seed);
        const sobra = saldo(perde.id) - r.aposta;
        if ((hasTrait(pp, 'competicao') || hasTrait(pp, 'apostas')) && rng() < 0.6 && (!r.aposta || sobra >= 1)) {
          revanche = true;
          empates = 0;
          r.revanche = { aposta: r.aposta ? Math.max(0, Math.min(r.aposta, sobra, saldo(vence.id) + r.aposta)) : 0 };
          continue;
        }
        break;
      }
      r.jogadas = jogadas;
    }
  }
  r.fim = inicio + CAMINHADA_MS + Math.round(duracao(r, rng)) + FINAL_MS[tipo];
  return r;
}

/** Partidas que a roda decide, na ordem: quem venceu, quem perdeu e quanto vale cada uma. */
export function partidas(r: RodaAgendada): { vencedor: string; perdedor: string; aposta: number }[] {
  const [a, b] = r.participantes;
  if (!KINDS[r.tipo].match || !a || !b) return [];
  if (r.pontos) {
    const deA = r.pontos.filter((p) => p === 0).length;
    const aVence = deA > r.pontos.length - deA;
    return [{ vencedor: aVence ? a : b, perdedor: aVence ? b : a, aposta: r.aposta }];
  }
  const out: { vencedor: string; perdedor: string; aposta: number }[] = [];
  for (const [ga, gb] of r.jogadas ?? []) {
    const res = rpsResult(ga, gb);
    if (!res) continue;
    out.push({ vencedor: res === 1 ? a : b, perdedor: res === 1 ? b : a, aposta: out.length ? (r.revanche?.aposta ?? 0) : r.aposta });
  }
  return out;
}

interface EmAndamento {
  roda: RodaAgendada;
  /** Um jogador deixou de estar à toa antes do fim: a partida não vale (W.O. não paga). */
  abandonada: boolean;
  /** Quem saiu da roda (chamado para trabalhar) e pode entrar em outra quando voltar. */
  saiu: Set<string>;
}

interface Livre {
  a: AgenteSocial;
  p: Persona;
  shell: boolean;
  sonolento: boolean;
}

/** A agenda das rodas e o livro das carteiras, avançados por `passo` com os agentes do snapshot. */
export class MotorSocial {
  readonly carteiras: Wallets;
  private rodas: EmAndamento[] = [];
  /** Próxima vez que cada agente livre tem vontade de companhia. */
  private quer = new Map<string, number>();
  /** Última atividade e status vistos de cada agente (para pagar pedido atendido e entrega uma vez). */
  private vistos = new Map<string, { atividade: string | undefined; status: AgentInfo['status'] }>();
  /** Agentes do último snapshot (os que saíram inclusive: a gaveta deles ainda mostra a carteira). */
  private listados: string[] = [];
  private ritmoAtual: Ritmo;
  private sementes = new Map<string, number>();

  constructor(
    readonly semente: number,
    carteirasSalvas?: unknown,
    ritmo: Ritmo = 'normal',
  ) {
    this.carteiras = new Wallets(carteirasSalvas);
    this.ritmoAtual = ritmo;
  }

  get ritmo(): Ritmo {
    return this.ritmoAtual;
  }

  /** Troca o ritmo: as vontades pendentes são sorteadas de novo; rodas já decididas e carteiras ficam como estão. */
  mudarRitmo(ritmo: Ritmo): void {
    if (ritmo === this.ritmoAtual) return;
    this.ritmoAtual = ritmo;
    this.quer.clear();
  }

  /** Avança até `agora`: carteiras de quem chegou, pagamentos pelo trabalho, rodas que acabaram e rodas novas. */
  passo(agora: number, agentes: readonly AgenteSocial[]): void {
    const presentes = agentes.filter((a) => a.status !== 'offline');
    this.listados = agentes.map((a) => a.id);
    this.sementes = new Map(presentes.map((a) => [a.id, a.seed]));
    for (const id of this.vistos.keys()) if (!this.sementes.has(id)) this.vistos.delete(id);
    for (const a of presentes) this.observar(a, agora);
    const livres = new Map<string, Livre>();
    for (const a of presentes) {
      const d = disponivel(a, agora);
      if (d) livres.set(a.id, { a, p: personaFor(a.seed), ...d });
    }
    this.acompanhar(agora, livres);
    const ocupados = this.ocupados();
    const cheias = salasCheias(presentes);
    const convidaveis = new Map([...livres].filter(([id, l]) => !ocupados.has(id) && !(l.a.kind === 'sub' && cheias.has(l.a.roomId))));
    for (const id of this.quer.keys()) if (!convidaveis.has(id)) this.quer.delete(id);
    this.planejar(agora, convidaveis);
    this.carteiras.prune(agora);
  }

  /** Roda montada fora da agenda (depuração): entra no livro como as outras. */
  incluir(roda: RodaAgendada): void {
    this.rodas.push({ roda, abandonada: false, saiu: new Set() });
  }

  estado(): SocialSnapshot {
    const carteiras: Record<string, CarteiraInfo> = {};
    for (const id of this.listados) {
      const c = this.carteiras.info(id);
      if (c) carteiras[id] = c;
    }
    return { semente: this.semente, ritmo: this.ritmoAtual, rodas: this.rodas.map((r) => r.roda), carteiras };
  }

  // ------------------------------------------------------------------ trabalho

  private observar(a: AgenteSocial, agora: number): void {
    const { created } = this.carteiras.ensure(a, agora);
    const antes = this.vistos.get(a.id);
    this.vistos.set(a.id, { atividade: a.activity?.id, status: a.status });
    if (created || !antes) return;
    this.carteiras.payTasks(a, agora);
    if (a.kind === 'main' && a.activity && a.activity.id !== antes.atividade && a.activity.kind === 'done') {
      this.carteiras.credit(a.id, TURN_REWARD, '💬', 'Pedido atendido', agora);
    }
    if (a.kind === 'sub' && a.status === 'done' && antes.status !== 'done') {
      this.carteiras.credit(a.id, DELIVERY_REWARD, '📦', `Entregou: ${a.title ?? 'resultado'}`, agora);
    }
  }

  // ------------------------------------------------------------------ rodas em andamento

  private acompanhar(agora: number, livres: ReadonlyMap<string, Livre>): void {
    const seguem: EmAndamento[] = [];
    for (const e of this.rodas) {
      if (agora >= e.roda.fim) {
        if (!e.abandonada) this.pagar(e.roda, agora);
        for (const id of this.membros(e.roda)) this.quer.delete(id);
        continue;
      }
      for (const id of this.membros(e.roda)) {
        if (livres.has(id) || agora < this.entrada(e.roda, id)) continue;
        e.saiu.add(id);
        if (KINDS[e.roda.tipo].match && e.roda.participantes.indexOf(id) < 2) e.abandonada = true;
      }
      seguem.push(e);
    }
    this.rodas = seguem;
  }

  private pagar(r: RodaAgendada, agora: number): void {
    const icon = KINDS[r.tipo].emoji;
    const what = MATCH_WHAT[r.tipo] ?? 'na aposta';
    for (const p of partidas(r)) {
      this.carteiras.recordMatch(p.vencedor, p.perdedor);
      if (p.aposta) this.carteiras.transfer(p.perdedor, p.vencedor, p.aposta, icon, what, agora);
    }
  }

  private membros(r: RodaAgendada): string[] {
    return [...r.participantes, ...(r.tardios ?? []).map((t) => t.id)];
  }

  private entrada(r: RodaAgendada, id: string): number {
    return r.tardios?.find((t) => t.id === id)?.em ?? r.inicio;
  }

  private ocupados(): Set<string> {
    const out = new Set<string>();
    for (const e of this.rodas) for (const id of this.membros(e.roda)) if (!e.saiu.has(id)) out.add(id);
    return out;
  }

  // ------------------------------------------------------------------ rodas novas

  private planejar(agora: number, livres: Map<string, Livre>): void {
    for (const [id, l] of livres) {
      if (!this.quer.has(id) && !l.sonolento) this.quer.set(id, agora + entre(sorteio(this.semente, 'senta', id, agora), SENTADO_MS[this.ritmoAtual]) * (l.shell ? 1.3 : 1));
    }
    const vez = [...this.quer].filter(([, t]) => t <= agora).sort((x, y) => x[1] - y[1] || (x[0] < y[0] ? -1 : 1));
    for (const [id, t] of vez) {
      const l = livres.get(id);
      if (!l) continue;
      const rng = sorteio(this.semente, 'vontade', id, t);
      const comPar = [...livres.keys()].some((o) => o !== id) || this.aberta(l, agora, () => 1) !== null;
      if (comPar && rng() < (l.shell ? 0.5 : 0.45) + l.p.sociability * 0.4 && this.puxar(l, agora, livres, rng)) continue;
      this.quer.set(id, agora + (entre(rng, PASSEIO_MS) + entre(rng, SENTADO_MS[this.ritmoAtual])) * (l.shell ? 1.3 : 1));
    }
  }

  /** `l` quer companhia: entra numa roda em andamento ou começa uma com quem está livre. */
  private puxar(l: Livre, agora: number, livres: Map<string, Livre>, rng: () => number): boolean {
    const aberta = this.aberta(l, agora, rng);
    if (aberta && rng() < 0.4) return this.entrar(aberta, l, agora, livres);
    const cands = [...livres.values()].filter((o) => o.a.id !== l.a.id);
    const avail: Partial<Record<GatherKind, boolean>> = {};
    for (const k of Object.keys(KINDS) as GatherKind[]) {
      if (!this.cabe(k)) continue;
      const need = k === 'mirror' ? (l.shell ? 1 : 0) : KINDS[k].min - 1;
      if (cands.length < need) continue;
      avail[k] = true;
    }
    const kind = pickKind(rng, l.p, avail);
    if (kind && this.comecar(kind, l, cands, agora, livres, rng)) return true;
    return aberta ? this.entrar(aberta, l, agora, livres) : false;
  }

  private cabe(k: GatherKind): boolean {
    const lugar = LUGAR[k];
    return this.rodas.filter((e) => LUGAR[e.roda.tipo] === lugar).length < VAGAS[lugar];
  }

  private comecar(kind: GatherKind, host: Livre, cands: Livre[], agora: number, livres: Map<string, Livre>, rng: () => number): boolean {
    const info = KINDS[kind];
    let want: number;
    if (kind === 'tv') want = 1 + Math.floor(rng() * 3);
    else if (kind === 'kitchen') want = 1 + Math.floor(rng() * 2.4);
    else if (kind === 'mirror') want = host.shell ? 1 : cands.some((c) => hasTrait(c.p, 'vaidade')) && rng() < 0.5 ? 1 : 0;
    else want = info.min - 1;
    // torcida já na largada, às vezes
    if ((kind === 'pingpong' || kind === 'videogame' || kind === 'rps') && rng() < 0.3) want++;
    want = Math.max(0, Math.min(want, cands.length, info.max - 1));
    const ranked = cands
      .map((c) => {
        let s = partnerScore(kind, c.p, bondBetween(host.a.seed, c.a.seed), rng);
        if (c.sonolento) s -= 1.5;
        if (kind === 'mirror' && !hasTrait(c.p, 'vaidade')) s -= 2;
        return { c, s };
      })
      .sort((x, y) => y.s - x.s || (x.c.a.id < y.c.a.id ? -1 : 1));
    // dorminhocos (ociosos há muito tempo) às vezes nem acordam com o convite
    const chosen = ranked
      .slice(0, want)
      .map((x) => x.c)
      .filter((c, i) => i < info.min - 1 || !c.sonolento || rng() < 0.35);
    if (chosen.length + 1 < (kind === 'mirror' ? (host.shell ? 2 : 1) : info.min)) return false;
    const id = `${agora.toString(36)}-${hash32(host.a.id).toString(36)}`;
    const roda = montarRoda(this.semente, id, kind, [host.a, ...chosen.map((c) => c.a)], agora, (x) => this.carteiras.coins(x));
    this.rodas.push({ roda, abandonada: false, saiu: new Set() });
    for (const q of [host, ...chosen]) {
      livres.delete(q.a.id);
      this.quer.delete(q.a.id);
    }
    return true;
  }

  /** Roda em andamento que aceita mais um (TV, torcida do jogo, papo na copa), pelo gosto de `l`. */
  private aberta(l: Livre, agora: number, rng: () => number): EmAndamento | null {
    let best: EmAndamento | null = null;
    let bestScore = 0;
    for (const e of this.rodas) {
      const k = e.roda.tipo;
      if (k === 'talk' || k === 'arcade' || k === 'mirror') continue;
      if (e.roda.fim - agora < ENTRADA_MIN_MS) continue;
      const dentro = this.membros(e.roda).filter((id) => !e.saiu.has(id));
      if (dentro.length >= KINDS[k].max) continue;
      let s = KINDS[k].match ? 0.8 : 1;
      s *= k === 'tv' ? (hasTrait(l.p, 'series') ? 3 : 1.4) : k === 'kitchen' ? (hasTrait(l.p, 'fofoca') || hasTrait(l.p, 'cafeina') ? 2.5 : 1) : hasTrait(l.p, 'competicao') || hasTrait(l.p, 'esporte') || hasTrait(l.p, 'games') ? 2 : 1;
      for (const id of dentro) {
        const seed = this.sementes.get(id);
        if (seed !== undefined && bondBetween(l.a.seed, seed) === 'amizade') s += 0.8;
      }
      s *= 0.6 + rng() * 0.8;
      if (s > bestScore) {
        bestScore = s;
        best = e;
      }
    }
    return best;
  }

  private entrar(e: EmAndamento, l: Livre, agora: number, livres: Map<string, Livre>): boolean {
    (e.roda.tardios ??= []).push({ id: l.a.id, em: agora });
    livres.delete(l.a.id);
    this.quer.delete(l.a.id);
    return true;
  }
}
