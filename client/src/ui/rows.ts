// Linha de agente (avatar, nome, conta, papel, status e atividade), usada na barra lateral e na gaveta.
import type { AccountInfo, AgentInfo } from '../../../shared/types';
import { partsKey } from '../../../shared/appearance';
import { createAvatar, updateAvatar, type AvatarSize } from './avatar';
import { h, setAttr, setHidden, setStyleVar, setText, setTitle, setVariant } from './dom';
import { formatDuration } from './format';
import { activityFallback, shellLine, shellStage, shellWaitIn, statusLabel, type ShellWait } from './model';
import {
  createAccountChip,
  createActivityLine,
  createRoleBadge,
  createStatusDot,
  updateAccountChip,
  updateActivityLine,
  updateRoleBadge,
  updateShellActivityLine,
  updateStatusDot,
} from './widgets';

interface RowRefs {
  avatar: HTMLElement;
  name: HTMLElement;
  chip: HTMLElement;
  role: HTMLElement;
  tag: HTMLElement;
  dot: HTMLElement;
  activity: HTMLElement;
  /** Título da sessão (do que se trata), como no hover do personagem. */
  task: HTMLElement;
  /** Há quanto tempo está ocioso (no lugar do "Principal"). */
  since: HTMLElement;
  size: AvatarSize;
  /** Assinatura da última atualização: igual na próxima, a linha já está certa. */
  sig?: string;
}

const refs = new WeakMap<HTMLElement, RowRefs>();

export function createAgentRow(agent: AgentInfo, onPick: (id: string) => void, size: AvatarSize = 'md'): HTMLButtonElement {
  const avatar = createAvatar(agent, size);
  const name = h('span', { class: 'ui-agent__name' });
  const chip = createAccountChip('sm');
  const role = createRoleBadge();
  const tag = h('span', { class: 'ui-agent__tag', text: 'parado por você', hidden: true });
  const dot = createStatusDot();
  const activity = createActivityLine();
  const task = h('span', { class: 'ui-agent__task', hidden: true });
  const since = h('span', { class: 'ui-agent__since', hidden: true });
  const row = h(
    'button',
    { class: 'ui-agent', type: 'button' },
    avatar,
    h('span', { class: 'ui-agent__main' }, h('span', { class: 'ui-agent__top' }, name, chip, since, role, tag), task, activity),
    dot,
  );
  row.dataset.id = agent.id;
  row.addEventListener('click', () => onPick(row.dataset.id!));
  refs.set(row, { avatar, name, chip, role, tag, dot, activity, task, since, size });
  return row;
}

interface EntradasDaLinha {
  sig: string;
  idleFor: number;
  showIdle: boolean;
  wait: ShellWait | null;
}

/**
 * Tudo o que `updateAgentRow` lê, já no grão em que aparece na tela (o cronômetro do shell, o "ocioso há").
 * Duas chamadas com a mesma assinatura deixam a linha igual.
 */
function entradasDaLinha(agent: AgentInfo, account: AccountInfo | undefined, selected: boolean, now: number, agents: readonly AgentInfo[]): EntradasDaLinha {
  const idleFor = agent.kind === 'main' && agent.status === 'idle' && agent.statusSince ? now - agent.statusSince : 0;
  const showIdle = idleFor >= 60_000;
  const wait = shellWaitIn(agent, agents, now);
  const a = agent.activity;
  const shell = wait ? `${shellLine(wait, now).text}\u0001${wait.main?.command ?? ''}\u0001${shellStage(now - wait.since).stage}\u0001${wait.foreground}` : '';
  const sig = [
    agent.id, agent.seed, agent.look, agent.kind, partsKey(agent.parts), agent.name, agent.account, agent.role, agent.background, agent.stoppedByUser, agent.title, agent.status, agent.waitingFor,
    account?.short, account?.color, account?.name, account?.email,
    selected,
    showIdle ? formatDuration(idleFor) : '',
    a?.icon, a?.text, a?.detail, a?.tool, a?.error,
    shell,
  ].join('\u0001');
  return { sig, idleFor, showIdle, wait };
}

export function assinaturaDaLinha(agent: AgentInfo, account: AccountInfo | undefined, selected: boolean, now: number, agents: readonly AgentInfo[] = []): string {
  return entradasDaLinha(agent, account, selected, now, agents).sig;
}

/**
 * `now` = relógio do servidor (cronômetro do shell e limiar dos comandos longos em primeiro plano);
 * `agents` = agentes do escritório (shells que um subagente deixou rodando contam para o principal).
 */
export function updateAgentRow(
  row: HTMLElement,
  agent: AgentInfo,
  account: AccountInfo | undefined,
  selected: boolean,
  now: number,
  agents: readonly AgentInfo[] = [],
): void {
  const r = refs.get(row);
  if (!r) return;
  const { sig, idleFor, showIdle, wait } = entradasDaLinha(agent, account, selected, now, agents);
  if (r.sig === sig) return;
  r.sig = sig;
  row.dataset.id = agent.id;
  updateAvatar(r.avatar, agent, r.size);
  setStyleVar(row, '--acc', account?.color ?? '#8b98b3');
  setText(r.name, agent.name);
  updateAccountChip(r.chip, account, agent.account);
  updateRoleBadge(r.role, agent);
  setHidden(r.tag, !agent.stoppedByUser);
  const title = agent.title?.trim() ?? '';
  setText(r.task, title);
  setTitle(r.task, title);
  setHidden(r.task, !title);
  // Agente principal ocioso há 1 min ou mais: o tempo aparece no lugar do "Principal".
  setText(r.since, showIdle ? `ocioso ${formatDuration(idleFor)}` : '');
  setTitle(r.since, showIdle ? `Ocioso há ${formatDuration(idleFor)}` : '');
  setHidden(r.since, !showIdle);
  setHidden(r.role, showIdle);
  // Esperando um shell (ou parado num comando longo): ampulheta no ponto e o cronômetro na linha de atividade.
  const status = wait ? 'shell' : agent.status;
  updateStatusDot(r.dot, status);
  if (wait) updateShellActivityLine(r.activity, wait, now);
  else updateActivityLine(r.activity, agent.activity, activityFallback(agent));
  setVariant(row, 'is-', status);
  row.classList.toggle('is-selected', selected);
  setAttr(row, 'aria-current', selected ? 'true' : null);
  // Para leitores de tela, o tempo em minutos (o cronômetro mudaria o rótulo a cada segundo).
  const doing = wait ? `${shellLine(wait, now).label}, há ${formatDuration(now - wait.since)}` : agent.activity?.text;
  setAttr(
    row,
    'aria-label',
    `${agent.name}, ${agent.kind === 'main' ? 'agente principal' : `subagente ${agent.role}`}, ${account?.name ?? agent.account}, ${statusLabel(status)}${agent.stoppedByUser ? ', parado por você' : ''}${doing ? `: ${doing}` : ''}`,
  );
}
