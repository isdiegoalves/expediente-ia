// Versão nova disponível: lê GET /api/versao (o servidor só repassa o versao.json que o script do host grava).
// Falha de rede ou resposta torta mantém o que já havia. No ?mock=1 não há servidor: ?versao=nova|atual|origem|nunca
// simula cada situação.
import type { VersaoView } from '../../../shared/versao';

export const VERSAO_POLL_MS = 10 * 60_000;

export type BuscarVersao = () => Promise<VersaoView | null>;

export const buscarVersaoHttp: BuscarVersao = async () => {
  try {
    const res = await fetch('/api/versao', { cache: 'no-store' });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<VersaoView> | null;
    return body && typeof body.emUso === 'string' && typeof body.nova === 'boolean' ? (body as VersaoView) : null;
  } catch {
    return null;
  }
};

const MOCK_EM_USO = '1.0.0';

export function mockVersao(cenario: string | null, agora: number): VersaoView | null {
  if (!cenario) return null;
  const verificadoEm = new Date(agora - 3 * 3_600_000).toISOString();
  const publicadaEm = new Date(agora - 2 * 86_400_000).toISOString();
  const release = (versao: string) => ({ versao, publicadaEm, url: `https://github.com/isdiegoalves/expediente-ia/releases/tag/v${versao}` });
  if (cenario === 'nunca') return { emUso: MOCK_EM_USO, nova: false };
  if (cenario === 'atual') return { emUso: MOCK_EM_USO, nova: false, verificadoEm, ultima: release(MOCK_EM_USO) };
  if (cenario !== 'nova' && cenario !== 'origem') return null;
  const view: VersaoView = { emUso: MOCK_EM_USO, nova: true, verificadoEm, ultima: release('1.1.0') };
  if (cenario === 'origem') view.origem = { nome: 'Projeto de exemplo', ultima: '0.9.0', publicadaEm, url: 'https://example.com/releases/v0.9.0', analise: 'https://example.com/analise' };
  return view;
}

export class VersaoFeed {
  view: VersaoView | null = null;
  private subs = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private buscar: BuscarVersao,
    private intervaloMs: number = VERSAO_POLL_MS,
  ) {}

  onChange(fn: () => void): void {
    this.subs.add(fn);
  }

  start(): void {
    void this.atualizar();
    this.timer ??= setInterval(() => void this.atualizar(), this.intervaloMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async atualizar(): Promise<void> {
    const novo = await this.buscar();
    if (!novo || JSON.stringify(novo) === JSON.stringify(this.view)) return;
    this.view = novo;
    this.subs.forEach((fn) => fn());
  }
}
