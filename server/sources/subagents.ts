// Arquivos de subagentes de uma sessão:
//   <projeto>/<sessionId>/subagents/agent-<agentId>.jsonl (+ .meta.json)
//   <projeto>/<sessionId>/subagents/workflows/<runId>/agent-<agentId>.jsonl (+ .meta.json, journal.jsonl)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SubagentFile {
  agentId: string;
  path: string;
  metaPath: string;
  /** Execução de workflow dona do subagente (pasta subagents/workflows/<runId>/). */
  runId?: string;
}

export interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
  requestShape?: string;
  workflowPhase?: string;
  teamName?: string;
  /** Parâmetro `name` passado ao Agent. */
  name?: string;
  stoppedByUser?: boolean;
  /** Teammate (Agent com `name`): não termina no fim do turno, fica esperando mensagens. */
  teammate?: boolean;
}

/** Sem escrita há 5 s depois de um end_turn: concluiu. */
export const END_TURN_QUIET_MS = 5_000;
/** Sem escrita há 120 s e sem fechamento: parado (pode ter travado ou só estar demorando). */
export const IDLE_TIMEOUT_MS = 120_000;
/** Parado há tanto tempo que deixa de valer a pena esperar o fechamento. */
export const STALLED_GIVE_UP_MS = 1_800_000;
/** Com uma ferramenta em andamento (ex.: comando longo), espera mais antes de desistir. */
export const PENDING_TOOL_TIMEOUT_MS = 600_000;
/** No boot, só entram subagentes escritos nos últimos 90 s. */
export const BOOT_RECENT_MS = 90_000;

const AGENT_FILE = /^agent-([\w-]+)\.jsonl$/;

/** Pasta de dados da sessão (irmã do transcript <sessionId>.jsonl). */
export function sessionDirOf(transcriptPath: string): string {
  return transcriptPath.replace(/\.jsonl$/, '');
}

function listDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

export function listSubagentFiles(sessionDir: string): SubagentFile[] {
  const out: SubagentFile[] = [];
  const base = join(sessionDir, 'subagents');
  const collect = (dir: string, runId?: string) => {
    for (const name of listDir(dir)) {
      const m = AGENT_FILE.exec(name);
      if (!m) continue;
      const file: SubagentFile = { agentId: m[1], path: join(dir, name), metaPath: join(dir, `agent-${m[1]}.meta.json`) };
      if (runId) file.runId = runId;
      out.push(file);
    }
  };
  collect(base);
  for (const runId of listDir(join(base, 'workflows'))) collect(join(base, 'workflows', runId), runId);
  return out;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function parseSubagentMeta(raw: string): SubagentMeta | undefined {
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    if (!j || typeof j !== 'object') return undefined;
    const meta: SubagentMeta = {};
    const agentType = str(j.agentType);
    const description = str(j.description);
    const toolUseId = str(j.toolUseId);
    const requestShape = str(j.requestShape);
    const workflowPhase = str(j.workflowPhase);
    if (agentType) meta.agentType = agentType;
    if (description) meta.description = description;
    if (toolUseId) meta.toolUseId = toolUseId;
    if (typeof j.spawnDepth === 'number') meta.spawnDepth = j.spawnDepth;
    if (requestShape) meta.requestShape = requestShape;
    if (workflowPhase) meta.workflowPhase = workflowPhase;
    const teamName = str(j.teamName);
    const name = str(j.name);
    if (teamName) meta.teamName = teamName;
    if (name) meta.name = name;
    if (j.stoppedByUser === true) meta.stoppedByUser = true;
    if (j.taskKind === 'in_process_teammate') meta.teammate = true;
    return meta;
  } catch {
    return undefined;
  }
}

/** Rodada do gauntlet: prefixo `rN-` (1 ou 2 dígitos) no nome do subagente. */
export function rodadaDoNome(name: string | undefined): number | undefined {
  const m = name ? /^r(\d{1,2})-/.exec(name) : null;
  return m ? Number(m[1]) : undefined;
}

export function readSubagentMeta(metaPath: string): SubagentMeta | undefined {
  try {
    return parseSubagentMeta(readFileSync(metaPath, 'utf8'));
  } catch {
    return undefined;
  }
}

export interface JournalAgent {
  label?: string;
  done: boolean;
}

const JOURNAL_DONE = /^(completed?|finished|done|failed|errored|error|killed|cancell?ed|stopped|succeeded|result)$/i;

/** journal.jsonl de um workflow: rótulo de cada agente e quais já terminaram. */
export function parseJournal(text: string): Map<string, JournalAgent> {
  const out = new Map<string, JournalAgent>();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const agentId = str(j.agentId);
    const type = str(j.type);
    if (!agentId || !type) continue;
    const cur = out.get(agentId) ?? { done: false };
    const label = str(j.label);
    if (label) cur.label = label;
    if (JOURNAL_DONE.test(type)) cur.done = true;
    out.set(agentId, cur);
  }
  return out;
}

/** Papel exibido para o subagente. */
export function subagentRole(meta: SubagentMeta | undefined, spawnType?: string): string {
  const t = meta?.agentType ?? spawnType;
  if (!t) return 'Subagente';
  if (t === 'workflow-subagent') return 'Workflow';
  return t;
}

export interface IdleCheck {
  now: number;
  lastWriteAt: number;
  /** A última mensagem do subagente terminou com end_turn. */
  ended: boolean;
  /** Há ferramenta chamada sem resultado ainda. */
  pendingTool: boolean;
}

export type IdleVerdict = 'running' | 'stalled' | 'concluded';

/** end_turn + 5 s de silêncio conclui; silêncio de 120 s sem fechamento é "parado"; só muito depois desiste. */
export function idleVerdict(c: IdleCheck): IdleVerdict {
  const quiet = c.now - c.lastWriteAt;
  if (c.ended && !c.pendingTool && quiet >= END_TURN_QUIET_MS) return 'concluded';
  if (quiet >= STALLED_GIVE_UP_MS) return 'concluded';
  return quiet >= IDLE_TIMEOUT_MS ? 'stalled' : 'running';
}

export function concludedByIdle(c: IdleCheck): boolean {
  return idleVerdict(c) === 'concluded';
}
