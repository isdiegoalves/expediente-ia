import { describe, expect, it, vi } from 'vitest';
import { criarMaquete, FAIXA_DE_FOCO, opcaoMaquete, raioDaLinha, seguirFoco, webgl2Disponivel, type Efeito } from './maquete';
import { DEFAULT_PREFS, loadPrefs, PREFS_KEY, sanitizePrefs, savePrefs, worldOptionsFrom } from '../../ui/prefs';

describe('raio do desfoque por linha', () => {
  it('é zero dentro da faixa de foco e na borda dela', () => {
    expect(raioDaLinha(0.5, 0.5)).toBe(0);
    expect(raioDaLinha(0.5 + FAIXA_DE_FOCO / 2, 0.5)).toBe(0);
    expect(raioDaLinha(0.5 - FAIXA_DE_FOCO / 2, 0.5)).toBe(0);
  });
  it('cresce com a distância e chega ao máximo no fim da rampa', () => {
    const perto = raioDaLinha(0.5 + FAIXA_DE_FOCO / 2 + 0.1, 0.5);
    const longe = raioDaLinha(0.5 + FAIXA_DE_FOCO / 2 + 0.2, 0.5);
    expect(perto).toBeCloseTo(0.7324, 3);
    expect(longe).toBeGreaterThan(perto);
    expect(raioDaLinha(0.5 + FAIXA_DE_FOCO / 2 + 0.4, 0.5)).toBeCloseTo(30);
    expect(raioDaLinha(1, 0.05)).toBeCloseTo(30);
  });
  it('é simétrico em torno do foco e acompanha o foco', () => {
    expect(raioDaLinha(0.5 + 0.35, 0.5)).toBeCloseTo(raioDaLinha(0.5 - 0.35, 0.5));
    expect(raioDaLinha(0.9, 0.9)).toBe(0);
  });
});

describe('foco amortecido', () => {
  it('aproxima do alvo sem ultrapassar e converge', () => {
    let f = 0.5;
    for (let i = 0; i < 6; i++) {
      const prox = seguirFoco(f, 0.9, 1 / 60);
      expect(prox).toBeGreaterThan(f);
      expect(prox).toBeLessThan(0.9);
      f = prox;
    }
    for (let i = 0; i < 200; i++) f = seguirFoco(f, 0.9, 1 / 60);
    expect(f).toBeCloseTo(0.9, 3);
  });
});

function fakes(efeitoPronto: boolean | 'lanca' = true) {
  const efeito: Efeito = { desenhar: vi.fn(), liberar: vi.fn() };
  const ctxSobre = { setTransform: vi.fn(), clearRect: vi.fn() };
  const criados: { id: string; remove: ReturnType<typeof vi.fn>; width: number; height: number; fora: boolean; ouvintes: Record<string, (e: unknown) => void> }[] = [];
  const criarCanvas = vi.fn((id: string) => {
    const c = {
      id,
      width: 0,
      height: 0,
      fora: false,
      ouvintes: {} as Record<string, (e: unknown) => void>,
      addEventListener: vi.fn((tipo: string, cb: (e: unknown) => void) => void (c.ouvintes[tipo] = cb)),
      remove: vi.fn(() => void (c.fora = true)),
      getContext: vi.fn(() => ctxSobre),
    };
    criados.push(c);
    return c as unknown as HTMLCanvasElement;
  });
  const mundo = { width: 800, height: 600, getContext: vi.fn() } as unknown as HTMLCanvasElement;
  const criarEfeito = vi.fn(() => {
    if (efeitoPronto === 'lanca') throw new Error('shader não compila');
    return efeitoPronto ? efeito : null;
  });
  const reduzir = { valor: false };
  const aoFalhar = vi.fn();
  const maquete = criarMaquete({ criarCanvas, criarEfeito, aoFalhar, reduzirMovimento: () => reduzir.valor });
  return { efeito, ctxSobre, criados, mundo, criarCanvas, criarEfeito, aoFalhar, reduzir, maquete };
}

describe('controle do modo maquete', () => {
  it('desligado não cria canvas nem contexto WebGL, não toca no canvas do mundo e devolve null', () => {
    const f = fakes();
    for (let i = 0; i < 5; i++) expect(f.maquete.aplicar(false, f.mundo, 100, 600, 1 / 60)).toBeNull();
    expect(f.criarCanvas).not.toHaveBeenCalled();
    expect(f.criarEfeito).not.toHaveBeenCalled();
    expect(f.mundo.getContext).not.toHaveBeenCalled();
  });

  it('ligado cria uma vez, desenha todo quadro e entrega um canvas limpo e transparente para o overlay', () => {
    const f = fakes();
    expect(f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60)).toBe(f.ctxSobre);
    expect(f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60)).toBe(f.ctxSobre);
    expect(f.criados.map((c) => c.id)).toEqual(['maquete', 'maquete-overlay']);
    expect(f.criarEfeito).toHaveBeenCalledTimes(1);
    expect(f.efeito.desenhar).toHaveBeenCalledTimes(2);
    expect(f.ctxSobre.clearRect).toHaveBeenCalledTimes(2);
    expect(f.efeito.desenhar).toHaveBeenLastCalledWith(f.mundo, 0.5);
    expect(f.criados[1]).toMatchObject({ width: 800, height: 600 });
  });

  it('desligar libera o contexto e remove os dois canvas; ligar de novo recria', () => {
    const f = fakes();
    f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60);
    expect(f.maquete.aplicar(false, f.mundo, null, 600, 1 / 60)).toBeNull();
    expect(f.efeito.liberar).toHaveBeenCalledTimes(1);
    for (const c of f.criados) expect(c.remove).toHaveBeenCalledTimes(1);
    f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60);
    expect(f.criarEfeito).toHaveBeenCalledTimes(2);
  });

  it('sem WebGL2 não tenta de novo a cada quadro, não deixa canvas e o overlay segue no mundo', () => {
    const f = fakes(false);
    for (let i = 0; i < 5; i++) expect(f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60)).toBeNull();
    expect(f.criarEfeito).toHaveBeenCalledTimes(1);
    expect(f.criados).toHaveLength(1);
    expect(f.criados[0].remove).toHaveBeenCalled();
  });

  it('fábrica que lança: 10 quadros, nenhum canvas fica, o overlay segue no mundo e só tenta uma vez', () => {
    const f = fakes('lanca');
    for (let i = 0; i < 10; i++) expect(f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60)).toBeNull();
    expect(f.criarEfeito).toHaveBeenCalledTimes(1);
    expect(f.criados.filter((c) => !c.fora)).toHaveLength(0);
    expect(f.aoFalhar).toHaveBeenCalledTimes(1);
  });

  it('getContext(webgl2) nulo avisa a falha e não deixa canvas', () => {
    const f = fakes(false);
    f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60);
    expect(f.aoFalhar).toHaveBeenCalledTimes(1);
    expect(f.criados.filter((c) => !c.fora)).toHaveLength(0);
  });

  it('contexto perdido em execução avisa a falha, remove os canvas e devolve o overlay ao mundo', () => {
    const f = fakes();
    expect(f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60)).toBe(f.ctxSobre);
    const evento = { preventDefault: vi.fn() };
    f.criados[0].ouvintes.webglcontextlost(evento);
    expect(evento.preventDefault).toHaveBeenCalled();
    expect(f.aoFalhar).toHaveBeenCalledTimes(1);
    expect(f.criados.filter((c) => !c.fora)).toHaveLength(0);
    expect(f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60)).toBeNull();
    expect(f.criarEfeito).toHaveBeenCalledTimes(1);
  });

  it('erro ao desenhar o quadro desliga o efeito no mesmo quadro', () => {
    const f = fakes();
    (f.efeito.desenhar as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('gl');
    });
    expect(f.maquete.aplicar(true, f.mundo, null, 600, 1 / 60)).toBeNull();
    expect(f.aoFalhar).toHaveBeenCalledTimes(1);
    expect(f.criados.filter((c) => !c.fora)).toHaveLength(0);
  });

  it('o foco segue o mouse e fica no meio com movimento reduzido', () => {
    const f = fakes();
    for (let i = 0; i < 300; i++) f.maquete.aplicar(true, f.mundo, 540, 600, 1 / 60);
    expect((f.efeito.desenhar as ReturnType<typeof vi.fn>).mock.lastCall?.[1]).toBeCloseTo(0.9, 2);
    const g = fakes();
    g.reduzir.valor = true;
    for (let i = 0; i < 300; i++) g.maquete.aplicar(true, g.mundo, 540, 600, 1 / 60);
    expect((g.efeito.desenhar as ReturnType<typeof vi.fn>).mock.lastCall?.[1]).toBe(0.5);
  });
});

describe('opção nas Configurações', () => {
  it('sem WebGL2 fica desativada com a frase do porquê', () => {
    expect(webgl2Disponivel({})).toBe(false);
    expect(webgl2Disponivel({ WebGL2RenderingContext: function () {} })).toBe(true);
    const sem = opcaoMaquete(false);
    expect(sem.desativada).toBe(true);
    expect(sem.dica).toContain('WebGL2');
    expect(opcaoMaquete(true).desativada).toBe(false);
    const falhou = opcaoMaquete(true, true);
    expect(falhou.desativada).toBe(true);
    expect(falhou.dica).toContain('aceleração gráfica');
  });
});

describe('preferência do modo maquete', () => {
  const memoria = () => {
    const d = new Map<string, string>();
    return { d, getItem: (k: string) => d.get(k) ?? null, setItem: (k: string, v: string) => void d.set(k, v) };
  };
  it('vem desligada de fábrica e valor inválido volta a desligado', () => {
    expect(DEFAULT_PREFS.maquete).toBe(false);
    expect(loadPrefs(memoria()).maquete).toBe(false);
    expect(sanitizePrefs({ maquete: 'sim' }).maquete).toBe(false);
    expect(worldOptionsFrom(DEFAULT_PREFS).maquete).toBe(false);
  });
  it('persiste ligada e chega ao mundo', () => {
    const st = memoria();
    savePrefs(st, { ...DEFAULT_PREFS, maquete: true });
    expect(JSON.parse(st.d.get(PREFS_KEY)!).maquete).toBe(true);
    expect(worldOptionsFrom(loadPrefs(st)).maquete).toBe(true);
  });
});
