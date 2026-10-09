// Resumo do Expediente (GET /api/mod/summary) e os textos da linha de status e do /escritorio. Só dados e texto.
import { listaTexto, lerUso, type UsoAgente } from './escritorio'

/** Nomes na linha embaixo do prompt antes do "e mais N". */
const MAX_NAMES = 3

/** Quem precisa de você, como GET /api/mod/summary devolve (sem demo e sem esta sessão). */
export interface WaitingAgent {
  id: string
  name: string
  room: string
  account: string
  waitingFor: string
  since?: number
  /** Há pedido de permissão para responder pelo escritório. */
  answerable: boolean
}

export interface Summary {
  version: string
  agents: number
  working: number
  waiting: WaitingAgent[]
  usage: UsoAgente[]
  self?: UsoAgente
}

/** Texto numa linha só (nomes e salas vêm do servidor; uma quebra de linha estragaria a linha de status). */
function oneLine(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim()
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? oneLine(v) : undefined
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0
}

/** Lê a resposta de GET /api/mod/summary; qualquer coisa fora do formato = undefined (vale "fora do ar"). */
export function parseSummary(text: string): Summary | undefined {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined
  const r = j as Record<string, unknown>
  if (!Array.isArray(r.waiting)) return undefined
  const waiting: WaitingAgent[] = []
  for (const item of r.waiting) {
    if (!item || typeof item !== 'object') continue
    const w = item as Record<string, unknown>
    const name = str(w.name)
    if (!name) continue
    const agent: WaitingAgent = {
      id: str(w.id) ?? name,
      name,
      room: str(w.room) ?? '?',
      account: str(w.account) ?? '',
      waitingFor: str(w.waitingFor) ?? 'responder no terminal',
      answerable: w.answerable === true,
    }
    if (typeof w.since === 'number' && Number.isFinite(w.since)) agent.since = w.since
    waiting.push(agent)
  }
  const usage = Array.isArray(r.usage) ? r.usage.map(lerUso).filter((u): u is UsoAgente => !!u) : []
  const self = lerUso(r.self)
  return { version: str(r.version) ?? '?', agents: count(r.agents), working: count(r.working), waiting, usage, ...(self ? { self } : {}) }
}

/** A linha embaixo do prompt: undefined quando ninguém (além desta sessão) precisa de você. */
export function statusText(waiting: readonly WaitingAgent[]): string | undefined {
  const first = waiting[0]
  if (!first) return undefined
  if (waiting.length === 1) return `🏢 ${first.name} precisa de você em ${first.room}`
  const shown = waiting.slice(0, MAX_NAMES).map((w) => `${w.name} (${w.room})`)
  const rest = waiting.length - shown.length
  return `🏢 ${waiting.length} precisam de você: ${shown.join(', ')}${rest > 0 ? ` e mais ${rest}` : ''}`
}

/** A resposta do /escritorio com o Expediente no ar. */
export function summaryText(s: Summary, url: string): string {
  const agents = s.agents === 1 ? '1 agente' : `${s.agents} agentes`
  const waiting = s.waiting.length === 0 ? 'ninguém precisa de você' : s.waiting.length === 1 ? '1 precisa de você' : `${s.waiting.length} precisam de você`
  const esperaPor = new Map(s.waiting.map((w) => [w.id, `${w.waitingFor}${w.answerable ? ' (dá para responder pelo escritório)' : ''}`]))
  return [`Expediente ${s.version} em ${url}`, `${agents} · ${s.working} trabalhando · ${waiting}`, ...listaTexto(s.usage, s.self, esperaPor)].join('\n')
}

export function offlineText(url: string): string {
  return `O Expediente não respondeu em ${url}. Para subir: npm run docker:up na pasta do Expediente.`
}

export function outdatedText(url: string): string {
  return `O Expediente em ${url} está numa versão sem a rota do mod. Para atualizar: git pull e npm run docker:up na pasta do Expediente.`
}
