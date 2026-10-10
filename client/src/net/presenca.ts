// Avisa o servidor quando esta aba fica visível ou oculta; é assim que ele sabe quando você saiu e quando voltou
// (ver server/history/resumo.ts). Sem servidor (?mock=1) nada é enviado.
import type { PresencaResposta } from '../../../shared/resumo';

export type EnviarPresenca = (aba: string, visivel: boolean) => Promise<PresencaResposta | null>;

export const enviarPresencaHttp: EnviarPresenca = async (aba, visivel) => {
  try {
    const res = await fetch('/api/resumo/presenca', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ aba, visivel }),
      keepalive: true,
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<PresencaResposta> | null;
    if (!body || typeof body.mostrar !== 'boolean') return null;
    return { saiuEm: typeof body.saiuEm === 'number' ? body.saiuEm : null, mostrar: body.mostrar };
  } catch {
    return null;
  }
};

export function novaAba(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

interface Alvo {
  addEventListener(type: string, listener: () => void): void;
}

export class PresencaDaAba {
  constructor(
    private readonly enviar: EnviarPresenca,
    private readonly aba: string,
    private readonly documento: Alvo & { hidden: boolean },
    private readonly janela: Alvo,
    private readonly aoResponder: (r: PresencaResposta) => void,
  ) {}

  start(): void {
    this.documento.addEventListener('visibilitychange', () => void this.avisar());
    this.janela.addEventListener('pageshow', () => void this.avisar());
    this.janela.addEventListener('pagehide', () => void this.enviar(this.aba, false));
    void this.avisar();
  }

  /** Diz ao servidor o estado atual; a resposta, com a aba visível, diz quando você saiu e se é hora de abrir o resumo. */
  async avisar(): Promise<void> {
    const visivel = !this.documento.hidden;
    const r = await this.enviar(this.aba, visivel);
    if (!r) return;
    if (visivel) this.aoResponder(r);
  }
}
