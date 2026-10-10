// Quem espera o dono: o texto e o agrupamento que a lista, o canvas e os avisos compartilham.

/** Lista de sessões que esperam o dono no app do Claude; sem `session`, o app abre a primeira pendente. */
export const LINK_LISTA_DE_ESPERA = 'claude://code/needs-input';

export function textoPrecisamDeVoce(n: number): string {
  return n === 1 ? '1 precisa de você' : `${n} precisam de você`;
}

export interface EsperaDaSala {
  /** Agente visível em que o balão da sala se apoia (o de menor id, para não trocar de cabeça a cada quadro). */
  ancora: string;
  total: number;
}

/** Cada sala com agente esperando ganha um balão só, com a contagem. */
export function esperaPorSala(esperando: readonly { id: string; roomId: string; visivel: boolean }[]): Map<string, EsperaDaSala> {
  const porSala = new Map<string, { total: number; ancora?: string }>();
  for (const a of esperando) {
    const s = porSala.get(a.roomId) ?? { total: 0 };
    s.total++;
    if (a.visivel && (s.ancora === undefined || a.id < s.ancora)) s.ancora = a.id;
    porSala.set(a.roomId, s);
  }
  const out = new Map<string, EsperaDaSala>();
  for (const [sala, s] of porSala) if (s.ancora !== undefined) out.set(sala, { ancora: s.ancora, total: s.total });
  return out;
}

/** O link da lista de espera do app só serve quando alguém que espera roda no app desktop. */
export function linkListaDeEspera(agentes: readonly { status: string; origin?: string }[]): string | undefined {
  return agentes.some((a) => a.status === 'waiting' && a.origin === 'app desktop') ? LINK_LISTA_DE_ESPERA : undefined;
}
