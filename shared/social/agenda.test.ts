// Agenda das rodas: determinística pela semente e pelo relógio, sem ninguém em duas rodas, com as
// apostas pagas no fim (W.O. não paga) e as moedinhas do trabalho pagas uma vez.
import { describe, expect, it } from 'vitest';
import type { AgentInfo, RodaAgendada } from '../types';
import { disponivel, montarRoda, MotorSocial, partidas, SHELL_SOCIAL_MIN_MS, type AgenteSocial } from './agenda';
import { DELIVERY_REWARD, START_COINS, TASK_REWARD, TURN_REWARD } from './carteiras';
import { KINDS, rpsResult, type Ritmo } from './regras';

const T0 = 1_700_000_000_000;

function agente(id: string, extra: Partial<AgenteSocial> = {}): AgenteSocial {
  let seed = 0;
  for (const c of id) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
  return { id, name: id[0].toUpperCase() + id.slice(1), kind: 'main', roomId: '/p', seed: Math.imul(seed, 2654435761) >>> 0, status: 'idle', statusSince: T0 - 60_000, tasks: [], ...extra };
}

const OCIOSOS = ['ana', 'bia', 'caio', 'davi', 'edu', 'fabi'].map((id) => agente(id));

function membros(r: RodaAgendada): string[] {
  return [...r.participantes, ...(r.tardios ?? []).map((t) => t.id)];
}

function subs(n: number, sala: string, de = 0): AgenteSocial[] {
  return Array.from({ length: n }, (_, i) => agente(`sub${de + i}${sala}`, { kind: 'sub', roomId: sala }));
}

const eSub = (id: string) => id.startsWith('sub');

/** Roda a agenda de segundo em segundo e guarda cada roda como ela estava na última vez que apareceu. */
function rodar(m: MotorSocial, segundos: number, agentes: (t: number) => readonly AgenteSocial[] = () => OCIOSOS, inicio = T0): Map<string, RodaAgendada> {
  const vistas = new Map<string, RodaAgendada>();
  for (let t = 0; t <= segundos * 1000; t += 1000) {
    m.passo(inicio + t, agentes(inicio + t));
    for (const r of m.estado().rodas) vistas.set(r.id, structuredClone(r));
  }
  return vistas;
}

describe('agenda das rodas', () => {
  it('mesma semente e mesmo relógio: as mesmas rodas, com os mesmos participantes, resultados e saldos', () => {
    const a = new MotorSocial(42);
    const b = new MotorSocial(42);
    const ra = rodar(a, 600);
    const rb = rodar(b, 600);
    expect(ra.size).toBeGreaterThan(10);
    expect([...rb.values()]).toEqual([...ra.values()]);
    expect(b.estado().carteiras).toEqual(a.estado().carteiras);
    const outra = rodar(new MotorSocial(43), 600);
    expect([...outra.values()]).not.toEqual([...ra.values()]);
  });

  it('o ritmo é o da simulação: com seis à toa, mais de uma roda por minuto, de tipos variados', () => {
    const vistas = [...rodar(new MotorSocial(7), 600).values()];
    expect(vistas.length).toBeGreaterThanOrEqual(15);
    expect(new Set(vistas.map((r) => r.tipo)).size).toBeGreaterThanOrEqual(5);
  });

  it('o ritmo muda a frequência: calmo tem menos rodas que normal, e normal menos que agitado, no mesmo intervalo', () => {
    const contar = (ritmo: Ritmo) => [5, 6, 7].reduce((n, semente) => n + rodar(new MotorSocial(semente, undefined, ritmo), 900).size, 0);
    const [calmo, normal, agitado] = [contar('calm'), contar('normal'), contar('lively')];
    expect(calmo).toBeLessThan(normal);
    expect(normal).toBeLessThan(agitado);
  });

  it('mesma semente, mesmo relógio e a mesma troca de ritmo: as mesmas rodas; o que já estava decidido termina igual', () => {
    const troca = T0 + 300_000;
    const a = new MotorSocial(21);
    const b = new MotorSocial(21);
    const seguir = (m: MotorSocial) => {
      const antes = rodar(m, 300);
      const decididas = m.estado().rodas.map((r) => structuredClone(r));
      const carteiras = structuredClone(m.estado().carteiras);
      m.mudarRitmo('lively');
      expect(m.estado().carteiras).toEqual(carteiras);
      const depois = rodar(m, 300, () => OCIOSOS, troca + 1000);
      // quem chega com a roda andando pode entrar depois da troca; o resto da roda fica como estava
      const semTardios = (r: RodaAgendada | undefined) => r && { ...r, tardios: undefined };
      for (const r of decididas) expect(semTardios(depois.get(r.id) ?? antes.get(r.id))).toEqual(semTardios(r));
      return [...antes.values(), ...depois.values()];
    };
    const ra = seguir(a);
    expect(seguir(b)).toEqual(ra);
    expect(a.estado().ritmo).toBe('lively');
    expect(ra.some((r) => r.inicio > troca)).toBe(true);
  });

  it('trocar de calmo para agitado vale na hora: as vontades pendentes são sorteadas de novo no ritmo novo', () => {
    // no calmo, a primeira vontade de cada um vem 16 s depois, no mínimo
    for (const semente of [1, 2, 3, 4, 5]) {
      const m = new MotorSocial(semente, undefined, 'calm');
      m.passo(T0, OCIOSOS);
      m.mudarRitmo('lively');
      const vistas = rodar(m, 14, () => OCIOSOS, T0 + 1000);
      expect([...vistas.values()].some((r) => r.inicio < T0 + 16_000), `semente ${semente}`).toBe(true);
    }
  });

  it('ninguém fica em duas rodas ao mesmo tempo e cada lugar respeita a lotação', () => {
    const vistas = [...rodar(new MotorSocial(5), 900).values()];
    const faixas = new Map<string, [number, number][]>();
    for (const r of vistas) {
      for (const id of r.participantes) (faixas.get(id) ?? faixas.set(id, []).get(id)!).push([r.inicio, r.fim]);
      for (const t of r.tardios ?? []) (faixas.get(t.id) ?? faixas.set(t.id, []).get(t.id)!).push([t.em, r.fim]);
    }
    for (const lista of faixas.values()) {
      lista.sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < lista.length; i++) expect(lista[i][0]).toBeGreaterThanOrEqual(lista[i - 1][1]);
    }
    for (let t = T0; t <= T0 + 900_000; t += 1000) {
      const agora = vistas.filter((r) => r.inicio <= t && t < r.fim);
      expect(agora.filter((r) => r.tipo === 'tv' || r.tipo === 'videogame').length).toBeLessThanOrEqual(1);
      expect(agora.filter((r) => r.tipo === 'pingpong').length).toBeLessThanOrEqual(1);
      expect(agora.filter((r) => r.tipo === 'arcade').length).toBeLessThanOrEqual(1);
    }
  });

  it('quem trabalha ou espera o usuário não entra; quem espera um shell entra só depois de 40 s', () => {
    expect(disponivel(agente('x', { status: 'working' }), T0)).toBeNull();
    expect(disponivel(agente('x', { status: 'waiting' }), T0)).toBeNull();
    expect(disponivel(agente('x', { status: 'shell', statusSince: T0 }), T0 + SHELL_SOCIAL_MIN_MS - 1)).toBeNull();
    expect(disponivel(agente('x', { status: 'shell', statusSince: T0 }), T0 + SHELL_SOCIAL_MIN_MS)).toEqual({ shell: true, sonolento: false });
    expect(disponivel(agente('x', { status: 'idle', statusSince: T0 - 11 * 60_000 }), T0)).toEqual({ shell: false, sonolento: true });
    const shells = [{ id: 'b1', label: 'Testes', startedAt: T0, background: true, kind: 'shell' as const }];
    const agentes = [agente('ana', { status: 'working' }), agente('bia', { status: 'waiting' }), agente('caio', { status: 'shell', statusSince: T0, shells }), agente('davi'), agente('edu')];
    const vistas = [...rodar(new MotorSocial(9), 600, () => agentes).values()];
    const quem = vistas.flatMap((r) => [...r.participantes, ...(r.tardios ?? []).map((t) => t.id)]);
    expect(quem).not.toContain('ana');
    expect(quem).not.toContain('bia');
    for (const r of vistas) if (r.participantes.includes('caio')) expect(r.inicio).toBeGreaterThanOrEqual(T0 + SHELL_SOCIAL_MIN_MS);
  });

  it('dorminhoco (ocioso há mais de 10 min) não puxa roda: só entra quando convidado', () => {
    const agentes = [agente('ana', { statusSince: T0 - 20 * 60_000 }), agente('bia', { statusSince: T0 - 20 * 60_000 })];
    expect(rodar(new MotorSocial(3), 600, () => agentes).size).toBe(0);
  });

  it('a partida paga no fim: o dinheiro só muda de mãos, a soma não muda e o placar dos dois fecha', () => {
    const m = new MotorSocial(11);
    const vistas = [...rodar(m, 900).values()];
    const pagas = vistas.filter((r) => r.fim <= T0 + 900_000).flatMap(partidas);
    expect(pagas.some((p) => p.aposta > 0)).toBe(true);
    const c = m.estado().carteiras;
    const total = OCIOSOS.reduce((s, a) => s + c[a.id].coins, 0);
    expect(total).toBe(OCIOSOS.length * START_COINS.main);
    const vitorias = OCIOSOS.reduce((s, a) => s + c[a.id].wins, 0);
    const derrotas = OCIOSOS.reduce((s, a) => s + c[a.id].losses, 0);
    expect(vitorias).toBe(pagas.length);
    expect(derrotas).toBe(pagas.length);
  });

  it('W.O. não paga: o jogador chamado para trabalhar antes do fim deixa a partida sem valor', () => {
    const vistas = [...rodar(new MotorSocial(13), 900).values()];
    const alvo = vistas.find((r) => partidas(r).some((p) => p.aposta > 0))!;
    expect(alvo).toBeDefined();
    const [p1] = alvo.participantes;
    const meio = Math.floor((alvo.inicio + alvo.fim) / 2 / 1000) * 1000;
    const ate = Math.ceil((alvo.fim - T0) / 1000) + 1;
    const semWO = new MotorSocial(13);
    rodar(semWO, ate);
    const comWO = new MotorSocial(13);
    rodar(comWO, ate, (t) => OCIOSOS.map((a) => (a.id === p1 && t >= meio ? { ...a, status: 'working', statusSince: meio } : a)));
    const jogo = (m: MotorSocial) => m.estado().carteiras[p1].ledger.filter((e) => e.at >= alvo.fim && e.icon === KINDS[alvo.tipo].emoji);
    expect(jogo(semWO).length).toBeGreaterThan(0);
    expect(jogo(comWO)).toEqual([]);
    const placar = (m: MotorSocial) => m.estado().carteiras[p1].wins + m.estado().carteiras[p1].losses;
    expect(placar(semWO)).toBe(placar(comWO) + partidas(alvo).length);
  });

  it('o resultado de cada jogo segue a regra: pingue-pongue até 5, videogame até 2, jokenpô com no máximo 3 empates seguidos', () => {
    const [ana, bia] = OCIOSOS;
    for (let i = 0; i < 200; i++) {
      const pp = montarRoda(1, `p${i}`, 'pingpong', [ana, bia], T0, () => 100);
      const placar = [0, 0];
      for (const p of pp.pontos!) placar[p]++;
      expect(Math.max(...placar)).toBe(5);
      expect(pp.pontos!.at(-1)).toBe(placar[0] === 5 ? 0 : 1);
      expect(pp.fim).toBeGreaterThan(pp.inicio);
      const vg = montarRoda(1, `v${i}`, 'videogame', [ana, bia], T0, () => 100);
      expect(Math.max(...[0, 1].map((k) => vg.pontos!.filter((p) => p === k).length))).toBe(2);
      const rps = montarRoda(1, `r${i}`, 'rps', [ana, bia], T0, () => 100);
      expect(rps.aposta).toBeGreaterThan(0);
      let empates = 0;
      for (const [a, b] of rps.jogadas!) {
        empates = rpsResult(a, b) === 0 ? empates + 1 : 0;
        expect(empates).toBeLessThanOrEqual(3);
      }
      expect(partidas(rps).length).toBeLessThanOrEqual(rps.revanche ? 2 : 1);
    }
    expect(montarRoda(1, 'pobre', 'rps', [ana, bia], T0, (id) => (id === 'bia' ? 0 : 100)).aposta).toBe(0);
  });

  it('moedinhas do trabalho: quem chega entra com saldo; tarefa, pedido atendido e entrega pagam uma vez', () => {
    const m = new MotorSocial(1);
    const base = agente('ana', { status: 'working', tasks: [{ id: '1', title: 'Login', status: 'in_progress' }], activity: { id: 'a1', kind: 'edit', icon: '✏️', text: 'Editando', at: T0 } });
    const sub = agente('rui', { kind: 'sub', status: 'working', title: 'Revisar' });
    m.passo(T0, [base, sub]);
    expect(m.estado().carteiras.ana.coins).toBe(START_COINS.main);
    expect(m.estado().carteiras.rui.coins).toBe(START_COINS.sub);
    const pronto: AgenteSocial = { ...base, status: 'idle', tasks: [{ id: '1', title: 'Login', status: 'completed' }], activity: { id: 'a2', kind: 'done', icon: '✅', text: 'Concluiu', at: T0 + 1000 } };
    const entregue: AgenteSocial = { ...sub, status: 'done' as AgentInfo['status'] };
    for (let i = 1; i <= 3; i++) m.passo(T0 + i * 1000, [pronto, entregue]);
    expect(m.estado().carteiras.ana.coins).toBe(START_COINS.main + TASK_REWARD + TURN_REWARD);
    expect(m.estado().carteiras.rui.coins).toBe(START_COINS.sub + DELIVERY_REWARD);
    expect(m.estado().carteiras.rui.ledger[0].text).toBe('Entregou: Revisar');
    // quem saiu ainda aparece no snapshot (indo embora): a gaveta segue com a carteira dele
    m.passo(T0 + 5_000, [{ ...pronto, status: 'offline' }]);
    expect(m.estado().carteiras.ana.coins).toBe(START_COINS.main + TASK_REWARD + TURN_REWARD);
  });

  it('doze subagentes à toa numa sala, mais do que viram personagem: nenhum entra em roda nem ganha ou perde moedinha', () => {
    for (const semente of [1, 3, 7]) {
      const time = subs(12, '/time');
      const m = new MotorSocial(semente);
      const vistas = [...rodar(m, 300, () => [agente('chefe', { roomId: '/time' }), ...time]).values()];
      expect(vistas.filter((r) => membros(r).some(eSub)), `semente ${semente}`).toEqual([]);
      const c = m.estado().carteiras;
      expect(time.map((s) => [c[s.id].coins, c[s.id].wins + c[s.id].losses])).toEqual(time.map(() => [START_COINS.sub, 0]));
    }
  });

  it('trinta subagentes à toa numa sala: os principais, o da sala inclusive, seguem com as rodas deles, sem subagente', () => {
    const todos = [agente('chefe', { roomId: '/time' }), ...subs(30, '/time'), ...OCIOSOS];
    const vistas = [...rodar(new MotorSocial(4), 600, () => todos).values()];
    expect(vistas.length).toBeGreaterThan(10);
    expect(vistas.flatMap(membros).filter(eSub)).toEqual([]);
    expect(vistas.flatMap(membros)).toContain('chefe');
  });

  it('o corte é por sala e só conta subagente em atividade: nove não entram, oito entram, concluído não conta', () => {
    const chefe = agente('chefe', { roomId: '/time' });
    const comSub = (agentes: AgenteSocial[]) => new Set([...rodar(new MotorSocial(3), 300, () => agentes).values()].flatMap(membros).filter(eSub));
    expect(comSub([chefe, ...subs(9, '/time')]).size).toBe(0);
    expect(comSub([chefe, ...subs(8, '/time')]).size).toBeGreaterThan(0);
    const concluidos = subs(5, '/time', 8).map((s) => ({ ...s, status: 'done' as const }));
    expect(comSub([chefe, ...subs(8, '/time'), ...concluidos]).size).toBeGreaterThan(0);
    const duasSalas = comSub([chefe, ...subs(12, '/time'), ...subs(3, '/outra')]);
    expect(duasSalas.size).toBeGreaterThan(0);
    expect([...duasSalas].filter((id) => id.endsWith('/time'))).toEqual([]);
  });

  it('subagente que já está numa roda quando a sala enche fica nela até o fim (o personagem dele continua em cena)', () => {
    const poucos = [agente('chefe', { roomId: '/time' }), ...subs(4, '/time')];
    const m = new MotorSocial(3);
    let alvo: RodaAgendada | undefined;
    let t = T0;
    for (; t <= T0 + 300_000 && !alvo; t += 1000) {
      m.passo(t, poucos);
      alvo = structuredClone(m.estado().rodas.find((r) => r.participantes.some(eSub) && r.fim - t > 10_000));
    }
    expect(alvo).toBeDefined();
    const cheia = [...poucos, ...subs(10, '/time', 4)];
    for (; t < alvo!.fim; t += 1000) {
      m.passo(t, cheia);
      expect(m.estado().rodas.find((r) => r.id === alvo!.id)?.participantes).toEqual(alvo!.participantes);
    }
  });

  it('quem sai de uma roda e volta à toa antes do fim nunca é publicado em duas rodas ao mesmo tempo, nem de volta na que deixou', () => {
    let [testadas, seguiuSemEle, foiParaOutra, emDuas, deVolta] = [0, 0, 0, 0, 0];
    for (let semente = 1; semente <= 40; semente++) {
      const antes = new MotorSocial(semente);
      let alvo: RodaAgendada | undefined;
      for (let t = T0; t <= T0 + 900_000 && !alvo; t += 1000) {
        antes.passo(t, OCIOSOS);
        alvo = antes.estado().rodas.find((r) => (r.tipo === 'kitchen' || r.tipo === 'tv') && r.fim - r.inicio > 30_000);
      }
      if (!alvo) continue;
      testadas++;
      const { id, inicio, fim } = alvo;
      const quem = alvo.participantes.at(-1)!;
      const [sai, volta] = [inicio + 5_000, inicio + 13_000];
      const m = new MotorSocial(semente);
      const outras = new Set<string>();
      for (let t = T0; t <= fim + 30_000; t += 1000) {
        const fora = t >= sai && t < volta;
        m.passo(t, OCIOSOS.map((a) => (a.id === quem && fora ? { ...a, status: 'working', statusSince: sai } : a.id === quem && t >= volta ? { ...a, statusSince: volta } : a)));
        const rodas = m.estado().rodas;
        const todos = rodas.flatMap(membros);
        if (new Set(todos).size !== todos.length) emDuas++;
        const antiga = rodas.find((r) => r.id === id);
        if (t === sai && antiga) seguiuSemEle++;
        if (t >= sai && antiga && membros(antiga).includes(quem)) deVolta++;
        if (t >= volta && t < fim) for (const r of rodas) if (r.id !== id && membros(r).includes(quem)) outras.add(r.id);
      }
      if (outras.size) foiParaOutra++;
    }
    expect([emDuas, deVolta]).toEqual([0, 0]);
    expect(testadas).toBeGreaterThanOrEqual(30);
    expect(seguiuSemEle).toBeGreaterThanOrEqual(10);
    expect(foiParaOutra).toBeGreaterThanOrEqual(10);
  });

  it('roda que fica abaixo do mínimo acaba na hora: quem ficou não segue preso a ela', () => {
    const [ana, bia] = OCIOSOS;
    const m = new MotorSocial(1);
    m.incluir(montarRoda(1, 'papo', 'talk', [ana, bia], T0, () => 100));
    m.passo(T0 + 1_000, [ana, bia]);
    expect(m.estado().rodas.map((r) => r.id)).toEqual(['papo']);
    m.passo(T0 + 2_000, [ana, { ...bia, status: 'working' }]);
    expect(m.estado().rodas).toEqual([]);
  });

  it('torcedor que sai, inclusive o que chegou com o jogo andando, não derruba a partida: ela segue publicada e é paga no fim', () => {
    const quatro = OCIOSOS.slice(0, 4);
    const [ana, bia, caio, davi] = quatro;
    const m = new MotorSocial(1);
    const roda = montarRoda(1, 'jogo', 'pingpong', [ana, bia, caio], T0, () => 100);
    roda.tardios = [{ id: davi.id, em: T0 + 1_000 }];
    m.incluir(roda);
    const trabalhando = (ids: string[]) => quatro.map((a) => (ids.includes(a.id) ? { ...a, status: 'working' as const } : a));
    m.passo(T0 + 2_000, quatro);
    m.passo(T0 + 3_000, trabalhando(['davi']));
    expect(m.estado().rodas.map((r) => [r.id, r.participantes, r.tardios])).toEqual([['jogo', ['ana', 'bia', 'caio'], []]]);
    m.passo(T0 + 4_000, trabalhando(['davi', 'caio']));
    expect(m.estado().rodas.map((r) => [r.id, r.participantes])).toEqual([['jogo', ['ana', 'bia']]]);
    for (let t = T0 + 5_000; t <= roda.fim + 1_000; t += 1000) m.passo(t, trabalhando(['davi', 'caio']));
    const c = m.estado().carteiras;
    expect([c.ana.wins + c.ana.losses, c.bia.wins + c.bia.losses]).toEqual([1, 1]);
  });

  it('partida em que um jogador sai deixa de ser publicada na hora, e o outro fica livre para outra roda antes do fim previsto', () => {
    const vistas = [...rodar(new MotorSocial(13), 900).values()];
    const alvo = vistas.find((r) => partidas(r).some((p) => p.aposta > 0))!;
    const [p1, p2] = alvo.participantes;
    const sai = alvo.inicio + 3_000;
    const m = new MotorSocial(13);
    let outraDoP2 = false;
    for (let t = T0; t < alvo.fim; t += 1000) {
      m.passo(t, OCIOSOS.map((a) => (a.id === p1 && t >= sai ? { ...a, status: 'working', statusSince: sai } : a)));
      if (t < sai) continue;
      expect(m.estado().rodas.map((r) => r.id)).not.toContain(alvo.id);
      outraDoP2 ||= m.estado().rodas.some((r) => membros(r).includes(p2));
    }
    expect(outraDoP2).toBe(true);
  });

  it('mesma semente e mesmo relógio, com gente saindo, voltando e uma sala enchendo: as mesmas rodas e os mesmos saldos', () => {
    const cena = (t: number): AgenteSocial[] => {
      const s = (t - T0) / 1000;
      const daVez = Math.floor(s / 20) % OCIOSOS.length;
      const vaivem = OCIOSOS.map((a, i) => (i === daVez && s % 20 < 8 ? { ...a, status: 'working' as const } : a));
      return [...vaivem, ...subs(s < 240 ? 5 : 12, '/time')];
    };
    const a = new MotorSocial(42);
    const b = new MotorSocial(42);
    const ra = rodar(a, 480, cena);
    expect(ra.size).toBeGreaterThan(10);
    expect([...rodar(b, 480, cena).values()]).toEqual([...ra.values()]);
    expect(b.estado().carteiras).toEqual(a.estado().carteiras);
  });
});
