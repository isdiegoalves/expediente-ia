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

export interface SessaoResumo {
  nome: string
  sala: string
  estado: 'espera' | 'travou' | 'terminou' | 'trabalhando' | 'ociosa'
  motivo?: string
  tarefa?: { rotulo: string; texto: string }
  desde: number
}

/** Como GET /api/resumo devolve (o servidor já mascarou os textos). */
export interface Resumo {
  desde: number
  agora: number
  terminaram: number
  travaram: number
  esperam: number
  trabalhando: number
  sessoes: SessaoResumo[]
}

const ESTADOS = ['espera', 'travou', 'terminou', 'trabalhando', 'ociosa'] as const

/** Lê a resposta de GET /api/resumo; qualquer coisa fora do formato = undefined. */
export function parseResumo(text: string): Resumo | undefined {
  let j: unknown
  try {
    j = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined
  const r = j as Record<string, unknown>
  if (!Array.isArray(r.sessoes) || typeof r.desde !== 'number' || typeof r.agora !== 'number') return undefined
  const sessoes: SessaoResumo[] = []
  for (const item of r.sessoes) {
    if (!item || typeof item !== 'object') continue
    const s = item as Record<string, unknown>
    const nome = str(s.nome)
    const estado = ESTADOS.find((e) => e === s.estado)
    if (!nome || !estado) continue
    const out: SessaoResumo = { nome, sala: str(s.sala) ?? '?', estado, desde: typeof s.desde === 'number' ? s.desde : r.agora }
    const motivo = str(s.motivo)
    if (motivo) out.motivo = motivo
    const t = s.tarefa as Record<string, unknown> | undefined
    const rotulo = str(t?.rotulo)
    const texto = str(t?.texto)
    if (rotulo && texto) out.tarefa = { rotulo, texto }
    sessoes.push(out)
  }
  return { desde: r.desde, agora: r.agora, terminaram: count(r.terminaram), travaram: count(r.travaram), esperam: count(r.esperam), trabalhando: count(r.trabalhando), sessoes }
}

/** "2 h 5 min", "35 min", "menos de 1 min". */
export function duracaoTexto(ms: number): string {
  const min = Math.floor(Math.max(0, ms) / 60_000)
  if (min < 1) return 'menos de 1 min'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const resto = min % 60
  if (h >= 48) return `${Math.floor(h / 24)} dias`
  return resto ? `${h} h ${resto} min` : `${h} h`
}

const TITULOS: Record<SessaoResumo['estado'], string> = {
  espera: 'Esperam você',
  travou: 'Travaram',
  terminou: 'Terminaram',
  trabalhando: 'Trabalhando',
  ociosa: 'Ociosas',
}

/** A resposta de `/escritorio resumo` com o Expediente no ar: contagens e, por sessão, a última tarefa. */
export function resumoTexto(r: Resumo, url: string): string {
  const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`
  const linhas = [
    `Desde que você saiu, há ${duracaoTexto(r.agora - r.desde)} · Expediente em ${url}`,
    [plural(r.terminaram, 'terminou', 'terminaram'), plural(r.travaram, 'travou', 'travaram'), plural(r.esperam, 'espera você', 'esperam você'), `${r.trabalhando} trabalhando`].join(' · '),
  ]
  if (!r.sessoes.length) linhas.push('Nenhuma outra sessão aberta.')
  for (const estado of ESTADOS) {
    const doEstado = r.sessoes.filter((s) => s.estado === estado)
    if (!doEstado.length) continue
    linhas.push(`${TITULOS[estado]} (${doEstado.length})`)
    for (const s of doEstado) {
      linhas.push(`  ${s.nome} · ${s.sala}${s.motivo ? ` · ${s.motivo}` : ''}`)
      if (s.tarefa) linhas.push(`    ${s.tarefa.rotulo}: ${s.tarefa.texto}`)
    }
  }
  return linhas.join('\n')
}
