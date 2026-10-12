import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountInfo, AgentInfo, EquipeResumo, OfficeSnapshot, RoomInfo } from '../../../shared/types';
import { DemoSimulator } from '../../../shared/demo/simulator';
import type { UiContext } from './context';
import { Sidebar } from './sidebar';
import { Elemento, instalarFalsoDom, registro, removerFalsoDom, serializar, zerarRegistro } from './testing/falso-dom';

vi.mock('../art', () => ({
  roomTheme: () => ({ accent: '#336699' }),
  avatarCanvas: () => ({ width: 1, height: 1, toDataURL: () => 'data:image/png;base64,' }),
}));

const T0 = 1_700_000_000_000;
const CONTA: AccountInfo = { id: '.claude', short: 'C', name: 'Conta C', color: '#3366ff' } as AccountInfo;

let guardado: Map<string, string>;
let agora = T0;
let selecao: { type: 'agent' | 'room'; id: string } | null = null;
let snap: OfficeSnapshot;

beforeEach(() => {
  ({ guardado } = instalarFalsoDom());
  agora = T0;
  selecao = null;
});
afterEach(() => {
  removerFalsoDom();
  vi.restoreAllMocks();
});

function agente(id: string, sala: string, extra: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id,
    kind: 'main',
    roomId: sala,
    name: id,
    look: 'f',
    role: '',
    sessionId: `s-${id}`,
    account: CONTA.id,
    status: 'working',
    recent: [],
    tasks: [],
    startedAt: T0 + Number(id.replace(/\D/g, '') || 0),
    lastEventAt: T0,
    statusSince: T0,
    stats: {} as AgentInfo['stats'],
    seed: 7,
    ...extra,
  };
}

function sala(id: string, slot: number): RoomInfo {
  return { id, name: id, path: `/p/${id}`, slot, seed: slot } as RoomInfo;
}

/** `salas` salas com um principal e `subs` subagentes cada. */
function escritorio(salas: number, subs: number): OfficeSnapshot {
  const rooms: RoomInfo[] = [];
  const agents: AgentInfo[] = [];
  for (let s = 0; s < salas; s++) {
    rooms.push(sala(`sala${s}`, s));
    agents.push(agente(`m${s}`, `sala${s}`));
    for (let i = 0; i < subs; i++) agents.push(agente(`s${s}_${i}`, `sala${s}`, { kind: 'sub', parentId: `m${s}`, role: 'Explore', startedAt: T0 + 1 + i }));
  }
  return { rev: 1, serverTime: T0, rooms, agents, accounts: [CONTA], meta: {} } as unknown as OfficeSnapshot;
}

function montar(inicial: OfficeSnapshot): Sidebar {
  snap = inicial;
  const ctx = {
    store: {
      get snapshot() {
        return snap;
      },
      connection: 'mock',
      replaying: false,
    },
    prefs: { hiddenAccounts: [] },
    updatePrefs: () => {},
    now: () => agora,
    account: (id: string) => snap.accounts.find((a) => a.id === id),
    agent: (id: string) => snap.agents.find((a) => a.id === id),
    selection: () => selecao,
    select: () => {},
    invalidate: () => {},
    togglePanel: () => {},
    isNarrow: () => false,
  } as unknown as UiContext;
  const lateral = new Sidebar(ctx);
  lateral.render();
  return lateral;
}

/** Entrega um snapshot novo, com objetos novos como os que chegam do servidor. */
function atualizar(lateral: Sidebar, mudar: (s: OfficeSnapshot) => void): void {
  const novo = structuredClone(snap);
  mudar(novo);
  snap = novo;
  lateral.render();
}

const raiz = (l: Sidebar) => l.el as unknown as Elemento;
const todos = (l: Sidebar) => raiz(l).descendentes();
const linhas = (l: Sidebar) => new Map(todos(l).filter((e) => e.tag === 'button' && e.classes.has('ui-agent')).map((e) => [e.dados.id!, e]));
const secoes = (l: Sidebar) => todos(l).filter((e) => e.tag === 'section' && e.classes.has('ui-room'));
const secaoDe = (l: Sidebar, idSala: string) => secoes(l).find((s) => s.descendentes().some((e) => e.classes.has('ui-room__name') && e.texto === idSala))!;
const subarvore = (e: Elemento) => new Set([e, ...e.descendentes()]);
const tocadosEm = (e: Elemento) => [...subarvore(e)].filter((x) => registro.tocados.has(x)).length;
const alteradosEm = (e: Elemento) => [...subarvore(e)].filter((x) => registro.alterados.has(x)).length;
const ordem = (l: Sidebar, idSala: string) => secaoDe(l, idSala).descendentes().filter((e) => e.classes.has('ui-agent')).map((e) => e.dados.id);

function esperarMesmosNos(l: Sidebar, antes: Map<string, Elemento>, menos: string[] = []): void {
  const depois = linhas(l);
  for (const [id, no] of antes) if (!menos.includes(id)) expect(depois.get(id), `linha de ${id}`).toBe(no);
}

describe('lista lateral que só toca o que mudou', () => {
  it('um subagente muda de estado, tarefa e tempo: só a linha dele (e os contadores) é tocada', () => {
    const l = montar(escritorio(10, 30));
    const antes = linhas(l);
    expect(antes.size).toBe(310);
    zerarRegistro();
    atualizar(l, (s) => {
      const a = s.agents.find((x) => x.id === 's3_5')!;
      a.status = 'idle';
      a.statusSince = T0 + 5_000;
      a.title = 'outra tarefa';
      a.activity = { id: 'x', kind: 'read', icon: '🔎', text: 'Lendo arquivos', at: T0 } as AgentInfo['activity'];
    });

    expect(registro.criados).toBe(0);
    expect(registro.removidos).toBe(0);
    expect(registro.movidos).toBe(0);
    esperarMesmosNos(l, antes);
    const muda = antes.get('s3_5')!;
    expect(alteradosEm(muda)).toBeGreaterThan(0);
    for (const [id, no] of antes) if (id !== 's3_5') expect(tocadosEm(no), `linha de ${id}`).toBe(0);
    // Fora da linha, só o filtro de status (contadores) muda; nenhuma outra sala é tocada.
    const contadores = todos(l).find((e) => e.classes.has('ui-status-filters'))!;
    const fora = [...registro.alterados].filter((e) => !subarvore(muda).has(e) && !subarvore(contadores).has(e));
    expect(fora.map((e) => `${e.tag}.${[...e.classes].join('.')}`)).toEqual([]);
    for (let s = 0; s < 10; s++) if (s !== 3) expect(tocadosEm(secaoDe(l, `sala${s}`)), `sala${s}`).toBe(0);
  });

  it('um subagente muda: o outro principal da mesma sala não é tocado, nem a linha, nem o nó', () => {
    const inicial = escritorio(2, 6);
    inicial.agents.push(agente('m0b', 'sala0', { startedAt: T0 + 50 }), agente('s0b_0', 'sala0', { kind: 'sub', parentId: 'm0b', startedAt: T0 + 51 }));
    const l = montar(inicial);
    const outro = linhas(l).get('m0b')!.parentNode!.parentNode!;
    expect(outro.classes.has('ui-node')).toBe(true);
    zerarRegistro();
    atualizar(l, (s) => {
      s.agents.find((x) => x.id === 's0_3')!.title = 'novo';
    });
    expect(alteradosEm(linhas(l).get('s0_3')!)).toBeGreaterThan(0);
    expect(tocadosEm(outro)).toBe(0);
  });

  it('passa o tempo sem mudar nada: nada é tocado', () => {
    const l = montar(escritorio(10, 30));
    zerarRegistro();
    agora += 1_000;
    atualizar(l, () => {});
    expect(registro.criados + registro.removidos + registro.movidos).toBe(0);
    expect(registro.alterados.size).toBe(0);
    for (const s of secoes(l)) expect(tocadosEm(s)).toBe(0);
  });

  it('o cronômetro do shell corre só na linha de quem espera o shell', () => {
    const inicial = escritorio(3, 10);
    const a = inicial.agents.find((x) => x.id === 's1_2')!;
    a.status = 'shell';
    a.shells = [{ id: 'b1', label: 'Rodar a suíte', startedAt: T0, background: true, kind: 'shell' }];
    const l = montar(inicial);
    const antes = linhas(l);
    zerarRegistro();
    agora += 1_000;
    atualizar(l, () => {});
    expect(alteradosEm(antes.get('s1_2')!)).toBeGreaterThan(0);
    for (const [id, no] of antes) if (id !== 's1_2') expect(tocadosEm(no), id).toBe(0);
    expect(registro.criados + registro.removidos + registro.movidos).toBe(0);
  });

  it('o "ocioso há" do principal muda quando completa o minuto e só nele', () => {
    const inicial = escritorio(3, 5);
    const m = inicial.agents.find((x) => x.id === 'm2')!;
    m.status = 'idle';
    m.statusSince = T0;
    const l = montar(inicial);
    const antes = linhas(l);
    agora = T0 + 59_000;
    atualizar(l, () => {});
    zerarRegistro();
    agora = T0 + 61_000;
    atualizar(l, () => {});
    expect(antes.get('m2')!.descendentes().find((e) => e.classes.has('ui-agent__since'))!.texto).toMatch(/^ocioso /);
    expect(alteradosEm(antes.get('m2')!)).toBeGreaterThan(0);
    for (const [id, no] of antes) if (id !== 'm2') expect(tocadosEm(no), id).toBe(0);
  });

  it('um agente entra: só ele é criado, as outras linhas seguem com o mesmo nó', () => {
    const l = montar(escritorio(4, 10));
    const antes = linhas(l);
    zerarRegistro();
    atualizar(l, (s) => s.agents.push(agente('s2_novo', 'sala2', { kind: 'sub', parentId: 'm2', startedAt: T0 + 999 })));
    const depois = linhas(l);
    expect(depois.size).toBe(antes.size + 1);
    esperarMesmosNos(l, antes);
    expect(registro.removidos).toBe(0);
    const criada = depois.get('s2_novo')!;
    expect(criada).toBeDefined();
    expect(registro.criados).toBeGreaterThan(0);
    for (const [id, no] of antes) expect(tocadosEm(no), id).toBe(0);
    for (const s of [0, 1, 3]) expect(tocadosEm(secaoDe(l, `sala${s}`))).toBe(0);
  });

  it('um agente sai: só a linha dele sai', () => {
    const l = montar(escritorio(4, 10));
    const antes = linhas(l);
    zerarRegistro();
    atualizar(l, (s) => {
      s.agents = s.agents.filter((x) => x.id !== 's1_4');
    });
    const depois = linhas(l);
    expect(depois.has('s1_4')).toBe(false);
    expect(depois.size).toBe(antes.size - 1);
    esperarMesmosNos(l, antes, ['s1_4']);
    expect(registro.criados).toBe(0);
    expect(registro.removidos).toBeGreaterThan(0);
    for (const [id, no] of antes) if (id !== 's1_4') expect(tocadosEm(no), id).toBe(0);
  });

  it('um agente muda de sala: sai de uma, entra na outra, o resto fica', () => {
    const inicial = escritorio(4, 3);
    inicial.agents.push(agente('solo', 'sala0'));
    const l = montar(inicial);
    const antes = linhas(l);
    zerarRegistro();
    atualizar(l, (s) => {
      s.agents.find((x) => x.id === 'solo')!.roomId = 'sala2';
    });
    expect(ordem(l, 'sala0')).not.toContain('solo');
    expect(ordem(l, 'sala2')).toContain('solo');
    esperarMesmosNos(l, antes, ['solo']);
    expect(registro.removidos).toBeGreaterThan(0);
    expect(registro.criados).toBeGreaterThan(0);
    for (const [id, no] of antes) if (id !== 'solo') expect(tocadosEm(no), id).toBe(0);
    expect(tocadosEm(secaoDe(l, 'sala1'))).toBe(0);
    expect(tocadosEm(secaoDe(l, 'sala3'))).toBe(0);
  });

  it('quem passa a esperar você sobe, sem refazer nenhuma linha', () => {
    const l = montar(escritorio(4, 6));
    const antes = linhas(l);
    expect(ordem(l, 'sala3')[0]).toBe('m3');
    zerarRegistro();
    atualizar(l, (s) => {
      s.agents.find((x) => x.id === 's3_4')!.status = 'waiting';
    });
    expect(registro.criados).toBe(0);
    expect(registro.removidos).toBe(0);
    esperarMesmosNos(l, antes);
    // A sala com quem espera sobe para o topo e, nela, o principal com o subagente esperando.
    expect(secoes(l)[0]).toBe(secaoDe(l, 'sala3'));
    expect(registro.movidos).toBeGreaterThan(0);
    expect(secaoDe(l, 'sala3').descendentes().find((e) => e.classes.has('ui-room__wait'))!.texto).toBe('✋ 1');
    for (const [id, no] of antes) if (id !== 's3_4') expect(tocadosEm(no), id).toBe(0);
  });

  it('a ordem arrastada reordena sem recriar', () => {
    const l = montar(escritorio(2, 0));
    atualizar(l, (s) => s.agents.push(agente('m0b', 'sala0', { startedAt: T0 + 50 })));
    const antes = linhas(l);
    expect(ordem(l, 'sala0')).toEqual(['m0', 'm0b']);
    zerarRegistro();
    guardado.set('expediente:ordem-agentes', JSON.stringify({ sala0: ['s-m0b', 's-m0'] }));
    atualizar(l, () => {});
    expect(ordem(l, 'sala0')).toEqual(['m0b', 'm0']);
    expect(registro.criados + registro.removidos).toBe(0);
    esperarMesmosNos(l, antes);
  });

  it('filtro ligado: some quem não bate, o resto fica no mesmo nó e parado', () => {
    const inicial = escritorio(3, 4);
    inicial.agents.find((x) => x.id === 's1_1')!.status = 'waiting';
    const l = montar(inicial);
    const antes = linhas(l);
    zerarRegistro();
    l.setStatus('esperando');
    l.render();
    const depois = linhas(l);
    expect([...depois.keys()].sort()).toEqual(['m1', 's1_1']);
    expect(depois.get('m1')).toBe(antes.get('m1'));
    expect(depois.get('s1_1')).toBe(antes.get('s1_1'));
    expect(registro.criados).toBe(0);
    registro.tocados.clear();
    l.render();
    expect(tocadosEm(secaoDe(l, 'sala1'))).toBe(0);
  });

  it('sala recolhida: a lista segue atual por baixo e a sala só ganha a classe', () => {
    const l = montar(escritorio(3, 4));
    const antes = linhas(l);
    zerarRegistro();
    guardado.set('expediente:salas-recolhidas', JSON.stringify(['sala1']));
    atualizar(l, () => {});
    expect(secaoDe(l, 'sala1').classes.has('is-folded')).toBe(true);
    expect(registro.criados + registro.removidos + registro.movidos).toBe(0);
    esperarMesmosNos(l, antes);
    for (const [id, no] of antes) expect(tocadosEm(no), id).toBe(0);
    zerarRegistro();
    atualizar(l, (s) => {
      s.agents.find((x) => x.id === 's1_2')!.title = 'mudou com a sala recolhida';
    });
    expect(linhas(l).get('s1_2')!.descendentes().find((e) => e.classes.has('ui-agent__task'))!.texto).toBe('mudou com a sala recolhida');
    expect(tocadosEm(linhas(l).get('s1_3')!)).toBe(0);
  });

  it('a seleção toca só a linha que perdeu e a que ganhou o destaque', () => {
    const l = montar(escritorio(3, 4));
    const antes = linhas(l);
    selecao = { type: 'agent', id: 's0_1' };
    atualizar(l, () => {});
    expect(antes.get('s0_1')!.classes.has('is-selected')).toBe(true);
    zerarRegistro();
    selecao = { type: 'agent', id: 's2_3' };
    atualizar(l, () => {});
    expect(antes.get('s0_1')!.classes.has('is-selected')).toBe(false);
    expect(antes.get('s2_3')!.classes.has('is-selected')).toBe(true);
    for (const [id, no] of antes) if (id !== 's0_1' && id !== 's2_3') expect(tocadosEm(no), id).toBe(0);
  });

  it('o cabeçalho do time acompanha a contagem publicada pelo servidor', () => {
    const inicial = escritorio(1, 4);
    for (const a of inicial.agents) if (a.kind === 'sub') Object.assign(a, { teamName: 'time-a', sessionId: 's-m0' });
    const equipe = (trabalhando: number): EquipeResumo => ({ key: 's-m0|time:time-a', trabalhando, aToa: 0, concluidos: 0, total: 4, rodadas: [], paradosPorVoce: 0 }) as unknown as EquipeResumo;
    inicial.equipes = [equipe(4)];
    const l = montar(inicial);
    const resumo = () => todos(l).find((e) => e.classes.has('ui-grupo__resumo'))!.texto;
    expect(resumo()).toContain('4 trabalhando');
    atualizar(l, (s) => {
      s.equipes = [equipe(3)];
    });
    expect(resumo()).toContain('3 trabalhando');
  });

  it('a contagem da sala acompanha um agente que o filtro esconde', () => {
    const l = montar(escritorio(2, 3));
    l.setStatus('esperando');
    atualizar(l, (s) => {
      s.agents.find((x) => x.id === 's0_0')!.status = 'waiting';
    });
    const contagem = () => secaoDe(l, 'sala0').descendentes().find((e) => e.classes.has('ui-room__count'))!.texto;
    expect(contagem()).toBe('4');
    atualizar(l, (s) => {
      s.agents.find((x) => x.id === 's0_2')!.status = 'offline';
    });
    expect(contagem()).toBe('3');
  });

  it('o progresso das tarefas da sala acompanha uma tarefa que não aparece na linha', () => {
    const l = montar(escritorio(2, 3));
    atualizar(l, (s) => {
      s.agents.find((x) => x.id === 's0_1')!.tasks = [{ id: '1', title: 'a', status: 'completed' }, { id: '2', title: 'b', status: 'pending' }];
    });
    expect(secaoDe(l, 'sala0').descendentes().find((e) => e.classes.has('ui-room__tasks-text'))!.texto).toBe('1/2 tarefas');
  });

  it('guarda a ordem mostrada de cada sala mesmo quando a sala não mudou', () => {
    const l = montar(escritorio(2, 0));
    const ordemMostrada = () => (l as unknown as { shown: Map<string, { agent: AgentInfo }[]> }).shown;
    atualizar(l, () => {});
    expect(ordemMostrada().get('sala1')!.map((n) => n.agent.id)).toEqual(['m1']);
    expect(ordemMostrada().get('sala1')![0].agent).toBe(snap.agents.find((a) => a.id === 'm1'));
  });

  it('a conta renomeada reescreve as linhas dela', () => {
    const l = montar(escritorio(2, 2));
    atualizar(l, (s) => {
      s.accounts[0].short = 'Z';
    });
    expect(linhas(l).get('s1_1')!.descendentes().find((e) => e.classes.has('ui-acc-chip'))!.texto).toBe('Z');
  });
});

describe('o resultado não muda', () => {
  it('a lista atualizada aos poucos é igual à lista montada do zero, ao longo da simulação pesada', () => {
    const sim = new DemoSimulator({ seed: 11, speed: 20, sessions: 4, projects: 4, subs: 5 }, T0);
    agora = T0;
    const incremental = montar(sim.snapshot(T0));
    let passos = 0;
    const visto = { entrou: 0, saiu: 0, status: new Set<string>() };
    let ids = new Set(snap.agents.map((a) => a.id));
    for (let t = 1; t <= 90; t++) {
      agora = T0 + t * 2_000;
      if (sim.tick(agora).changed) {
        const novo = JSON.parse(JSON.stringify(sim.snapshot(agora))) as OfficeSnapshot;
        snap = novo;
        const agora_ = new Set(novo.agents.map((a) => a.id));
        visto.entrou += [...agora_].filter((id) => !ids.has(id)).length;
        visto.saiu += [...ids].filter((id) => !agora_.has(id)).length;
        ids = agora_;
        for (const a of novo.agents) visto.status.add(a.status);
        incremental.render();
        if (t % 10 === 0) {
          const doZero = montar(structuredClone(novo));
          const a = serializar(raiz(incremental));
          const b = serializar(raiz(doZero));
          const i = [...a].findIndex((c, k) => c !== b[k]);
          const de = Math.max(0, i - 250);
          expect(a.slice(de, de + 500), `passo ${t}`).toBe(b.slice(de, de + 500));
          snap = novo;
          passos++;
        }
      }
    }
    expect(passos).toBeGreaterThan(5);
    expect(visto.entrou).toBeGreaterThan(0);
    expect(visto.saiu).toBeGreaterThan(0);
    expect(visto.status.size).toBeGreaterThan(3);
  });
});
