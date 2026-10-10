// Urgência na lista lateral: filtro por status e "quem espera sobe" sem apagar a ordem arrastada.
import type { AgentInfo } from '../../../shared/types';
import type { AgentNode } from './model';

export type StatusFiltro = 'todos' | 'esperando' | 'trabalhando' | 'parados';

export const STATUS_FILTROS: readonly { id: StatusFiltro; rotulo: string }[] = [
  { id: 'todos', rotulo: 'Todos' },
  { id: 'esperando', rotulo: 'Esperam você' },
  { id: 'trabalhando', rotulo: 'Trabalhando' },
  { id: 'parados', rotulo: 'À toa' },
];

/** Esperando o shell conta como trabalhando; concluído e saindo contam como à toa. */
export function grupoDoStatus(status: AgentInfo['status']): Exclude<StatusFiltro, 'todos'> {
  if (status === 'waiting') return 'esperando';
  if (status === 'working' || status === 'shell') return 'trabalhando';
  return 'parados';
}

export function bateStatus(agent: Pick<AgentInfo, 'status'>, filtro: StatusFiltro): boolean {
  return filtro === 'todos' || grupoDoStatus(agent.status) === filtro;
}

export function contarPorStatus(agents: readonly Pick<AgentInfo, 'status'>[]): Record<StatusFiltro, number> {
  const c: Record<StatusFiltro, number> = { todos: 0, esperando: 0, trabalhando: 0, parados: 0 };
  for (const a of agents) {
    c.todos++;
    c[grupoDoStatus(a.status)]++;
  }
  return c;
}

/** Quantos esperam o dono neste agente e nos subagentes dele. */
export function esperamNoNo(n: Pick<AgentNode, 'agent' | 'subs'>): number {
  return (n.agent.status === 'waiting' ? 1 : 0) + n.subs.filter((s) => s.status === 'waiting').length;
}

/** Quem espera vai para o início; dentro de cada grupo a ordem recebida (a arrastada) fica como está. */
export function subirQuemEspera<T>(items: readonly T[], espera: (item: T) => boolean): T[] {
  const sobe: T[] = [];
  const resto: T[] = [];
  for (const i of items) (espera(i) ? sobe : resto).push(i);
  return [...sobe, ...resto];
}
