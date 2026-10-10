import { describe, expect, it } from 'vitest';
import type { IrInfo } from '../../../shared/types';
import { appRespondeu, cliqueNaSessao, copiadoTexto, ehLinkDaSessao, focarSessao, focavelNaGaveta, ordemTentada, SEM_MOD, type FocoDeps } from './ir';

describe('ir', () => {
  it('copiadoTexto: repete o rótulo da cópia por fork só quando o servidor o manda', () => {
    expect(copiadoTexto({ aviso: 'cria uma cópia, não responde à sessão original' })).toBe('Comando copiado: cria uma cópia, não responde à sessão original.');
    expect(copiadoTexto({})).toBe('Comando copiado.');
  });

  it('ordemTentada: o link do app só entra para o agente do app', () => {
    expect(ordemTentada({ origin: 'app desktop', links: [] })).toContain('indisponível');
    expect(ordemTentada({ origin: 'app desktop', links: [{ rotulo: 'x', href: 'claude://code/continue?session=local_ab-1' }] })).not.toContain('indisponível');
    expect(ordemTentada({ origin: 'terminal', links: [] })).not.toContain('link do app');
    expect(ordemTentada({ links: [] })).not.toContain('link do app');
  });

  it('ehLinkDaSessao: só claude://code/continue com id local_ do formato do app', () => {
    expect(ehLinkDaSessao('claude://code/continue?session=local_5e6f7a8b-aaaa')).toBe(true);
    expect(ehLinkDaSessao('claude://code/continue?session=last')).toBe(false);
    expect(ehLinkDaSessao('claude://code/continue?session=local_a&x=1')).toBe(false);
    expect(ehLinkDaSessao('claude://code/new?folder=%2Fp')).toBe(false);
    expect(ehLinkDaSessao('https://code/continue?session=local_a')).toBe(false);
  });

  it('appRespondeu: o app responde quando a página perdeu o foco ou ficou oculta', () => {
    expect(appRespondeu({ temFoco: false, visivel: true })).toBe(true);
    expect(appRespondeu({ temFoco: true, visivel: false })).toBe(true);
    expect(appRespondeu({ temFoco: true, visivel: true })).toBe(false);
  });
});

const TOKEN = 'b'.repeat(32);

/** Relógio falso: `esperar` avança o tempo e `estados` diz o que o servidor responde a cada consulta. */
function io(estados: (t: number) => string | undefined, post: { ok: boolean; json: unknown } = { ok: true, json: { token: TOKEN } }, vale = () => true) {
  let t = 0;
  const chamadas: string[] = [];
  const deps: FocoDeps = {
    post: async (url, corpo) => {
      chamadas.push(`POST ${url} ${JSON.stringify(corpo)}`);
      return post;
    },
    get: async (url) => {
      chamadas.push(`GET ${url}`);
      const estado = estados(t);
      return { ok: estado !== undefined, json: { estado } };
    },
    apagar: async (url) => void chamadas.push(`DELETE ${url}`),
    esperar: async (ms) => void (t += ms),
    agora: () => t,
    vale,
  };
  return { deps, chamadas, tempo: () => t };
}

describe('focarSessao', () => {
  it('pede com o nonce do /ir, consulta pelo token e termina em focado', async () => {
    const w = io((t) => (t < 500 ? 'pendente' : t < 1000 ? 'assumido' : 'focado'));
    expect(await focarSessao(w.deps, '.claude:507', 'n'.repeat(32))).toEqual({ tipo: 'focado' });
    expect(w.chamadas[0]).toBe(`POST /api/agentes/.claude%3A507/focar {"n":"${'n'.repeat(32)}"}`);
    expect(w.chamadas.slice(1).every((c) => c === `GET /api/focos/${TOKEN}`)).toBe(true);
  });

  it('ninguém assume em 3 s: ninguem, sem esperar mais que isso', async () => {
    const w = io(() => 'pendente');
    expect(await focarSessao(w.deps, 'a:1', 'n')).toEqual({ tipo: 'ninguem' });
    expect(w.tempo()).toBeGreaterThanOrEqual(3000);
    expect(w.tempo()).toBeLessThan(3500);
    expect(w.chamadas.at(-1)).toBe(`DELETE /api/focos/${TOKEN}`);
  });

  it('assumido e ainda sem resposta passa dos 3 s, mas desiste em 12 s', async () => {
    const w = io((t) => (t < 2000 ? 'pendente' : 'assumido'));
    expect(await focarSessao(w.deps, 'a:1', 'n')).toEqual({ tipo: 'motivo', texto: 'a sessão não respondeu' });
    expect(w.tempo()).toBeGreaterThan(10_000);
    expect(w.tempo()).toBeLessThan(13_000);
  });

  it('o motivo do mod aparece: sem painel, não é mais o claude, vencido', async () => {
    for (const [estado, texto] of [
      ['sem-painel', 'não achei o painel dessa sessão'],
      ['nao-e-claude', 'esse processo não é mais o Claude Code'],
      ['vencido', 'o pedido venceu antes de alguém executá-lo'],
    ] as const) {
      expect(await focarSessao(io(() => estado).deps, 'a:1', 'n')).toEqual({ tipo: 'motivo', texto });
    }
  });

  it('pedido recusado pelo servidor: motivo, sem consultar', async () => {
    const w = io(() => 'focado', { ok: false, json: { error: 'nonce' } });
    expect(await focarSessao(w.deps, 'a:1', 'n')).toEqual({ tipo: 'motivo', texto: 'o Expediente recusou o pedido' });
    expect(w.chamadas).toHaveLength(1);
  });

  it('clique superado por outro agente: para de consultar', async () => {
    let vale = true;
    const w = io(() => 'pendente', undefined, () => vale);
    const p = focarSessao(w.deps, 'a:1', 'n');
    vale = false;
    expect(await p).toEqual({ tipo: 'ninguem' });
    expect(w.chamadas).toEqual([expect.stringMatching(/^POST /), `DELETE /api/focos/${TOKEN}`]);
  });
});

const IR: IrInfo = { estado: 'vivo', origin: 'terminal', comando: 'claude --resume s --fork-session', aviso: 'cria uma cópia', links: [], focar: true, nonce: 'n'.repeat(32) };

function clique(estados: (t: number) => string | undefined, copiaOk = true, vale = () => true) {
  const w = io(estados);
  const eventos: string[] = [];
  const deps = {
    foco: w.deps,
    emFoco: () => void eventos.push('focando'),
    copiar: async (texto: string) => {
      eventos.push(`copiou ${texto}`);
      return copiaOk;
    },
    vale,
  };
  return { w, eventos, deps };
}

describe('cliqueNaSessao', () => {
  it('terminal viva com foco oferecido: mostra focando, e ao focar não copia nada', async () => {
    const c = clique(() => 'focado');
    expect(await cliqueNaSessao(IR, '.claude:507', c.deps)).toEqual({ info: 'Sessão em foco.', ordem: '', copiou: true });
    expect(c.eventos).toEqual(['focando']);
  });

  it('ninguém assume: avisa que não há sessão com o Expediente e copia o comando com o aviso de cópia', async () => {
    const c = clique(() => 'pendente');
    const r = await cliqueNaSessao(IR, '.claude:507', c.deps);
    expect(r?.info).toBe(`${SEM_MOD} Comando copiado: cria uma cópia.`);
    expect(c.eventos).toEqual(['focando', 'copiou claude --resume s --fork-session']);
  });

  it('o mod devolve um motivo: mostra o motivo e copia', async () => {
    const c = clique(() => 'sem-painel');
    expect((await cliqueNaSessao(IR, '.claude:507', c.deps))?.info).toBe('Não deu para focar: não achei o painel dessa sessão. Comando copiado: cria uma cópia.');
  });

  it('sem focar no /ir (sem mod, app desktop, encerrada) ou sem nonce: nem pede o foco, só copia', async () => {
    for (const ir of [{ ...IR, focar: undefined }, { ...IR, nonce: undefined }]) {
      const c = clique(() => 'focado');
      expect((await cliqueNaSessao(ir, '.claude:507', c.deps))?.info).toBe('Comando copiado: cria uma cópia.');
      expect(c.eventos).toEqual(['copiou claude --resume s --fork-session']);
      expect(c.w.chamadas).toEqual([]);
    }
  });

  it('cópia recusada: pede para selecionar e deixa o comando à vista', async () => {
    const c = clique(() => 'focado', false);
    const r = await cliqueNaSessao({ ...IR, focar: undefined }, '.claude:507', c.deps);
    expect(r).toMatchObject({ info: 'Não foi possível copiar. Selecione e copie (cria uma cópia):', copiou: false });
  });

  it('clique superado: nada é mostrado', async () => {
    const c = clique(() => 'focado', true, () => false);
    expect(await cliqueNaSessao(IR, '.claude:507', c.deps)).toBeUndefined();
  });
});

describe('focavelNaGaveta', () => {
  it('só terminal viva vira "Focar a sessão"', () => {
    expect(focavelNaGaveta({ origin: 'terminal', status: 'working' })).toBe(true);
    expect(focavelNaGaveta({ origin: 'terminal', status: 'offline' })).toBe(false);
    expect(focavelNaGaveta({ origin: 'app desktop', status: 'working' })).toBe(false);
    expect(focavelNaGaveta({ status: 'working' })).toBe(false);
  });
});
