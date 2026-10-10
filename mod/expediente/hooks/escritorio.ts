// Lista do /escritorio e escolha da ação de cada sessão no painel. Só texto e decisão: quem executa é o register.tsx.
import { argvAbrir } from './abrir'

export interface UsoAgente {
  id: string
  name: string
  kind: 'main' | 'sub'
  status: string
  room: string
  title?: string
  origin?: string
  context?: { tokens: number; window?: number; percent?: number }
  compactions: number
  lastCompaction?: { preTokens: number; postTokens: number }
  cost?: { usd?: number; estimated: boolean; unpriced: string[] }
  coins?: number
}

export interface IrView {
  estado: 'vivo' | 'encerrado'
  origin?: string
  comando: string
  aviso?: string
  links: Array<{ rotulo: string; href: string }>
  nonce?: string
}

const MAX_TITULO = 80
const NONCE = /^[0-9a-f]{32}$/
const CONTROLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

function umaLinha(s: string): string {
  return s.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/g, ' ').trim()
}

function texto(v: unknown): string | undefined {
  return typeof v === 'string' && umaLinha(v) ? umaLinha(v) : undefined
}

function numero(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined
}

export function lerUso(v: unknown): UsoAgente | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined
  const r = v as Record<string, unknown>
  const id = texto(r.id)
  const name = texto(r.name)
  const status = texto(r.status)
  if (!id || !name || !status || (r.kind !== 'main' && r.kind !== 'sub')) return undefined
  const u: UsoAgente = { id, name, kind: r.kind, status, room: texto(r.room) ?? '?', compactions: Math.floor(numero(r.compactions) ?? 0) }
  const title = texto(r.title)
  if (title) u.title = title
  const origin = texto(r.origin)
  if (origin) u.origin = origin
  const c = r.context
  if (c && typeof c === 'object') {
    const tokens = numero((c as Record<string, unknown>).tokens)
    if (tokens !== undefined) {
      u.context = { tokens }
      const window = numero((c as Record<string, unknown>).window)
      const percent = numero((c as Record<string, unknown>).percent)
      if (window !== undefined) u.context.window = window
      if (percent !== undefined) u.context.percent = percent
    }
  }
  const last = r.lastCompaction
  if (last && typeof last === 'object') {
    const pre = numero((last as Record<string, unknown>).preTokens)
    const post = numero((last as Record<string, unknown>).postTokens)
    if (pre !== undefined && post !== undefined) u.lastCompaction = { preTokens: pre, postTokens: post }
  }
  const cost = r.cost
  if (cost && typeof cost === 'object') {
    const k = cost as Record<string, unknown>
    const unpriced = Array.isArray(k.unpriced) ? k.unpriced.map(texto).filter((s): s is string => !!s) : []
    const usd = numero(k.usd)
    u.cost = { estimated: k.estimated === true, unpriced, ...(usd !== undefined ? { usd } : {}) }
  }
  const coins = numero(r.coins)
  if (coins !== undefined) u.coins = Math.floor(coins)
  return u
}

function decimal(n: number, casas: number): string {
  return n.toFixed(casas).replace('.', ',')
}

function tokensTexto(n: number): string {
  const v = Math.max(0, n)
  const curto = (x: number) => decimal(x, 1).replace(/,0$/, '')
  if (v < 1_000) return String(Math.round(v))
  if (v < 1_000_000) return `${curto(v / 1_000)} k`
  return `${curto(v / 1_000_000)} M`
}

export function contextoTexto(c: NonNullable<UsoAgente['context']>): string {
  if (c.window === undefined || c.percent === undefined) return `${tokensTexto(c.tokens)} tokens`
  return `${tokensTexto(c.tokens)} de ${tokensTexto(c.window)} (${c.percent}%)`
}

export function custoTexto(c: NonNullable<UsoAgente['cost']>): string {
  const semPreco = c.unpriced.length ? `sem preço para ${c.unpriced.join(', ')}` : ''
  if (c.usd === undefined) return semPreco
  const valor = `US$ ${decimal(c.usd, 2)}${c.estimated ? ' (estimado)' : ''}`
  return semPreco ? `${valor} · ${semPreco}` : valor
}

export function detalheTexto(u: UsoAgente): string {
  const partes: string[] = []
  if (u.context) partes.push(`contexto ${contextoTexto(u.context)}`)
  if (u.compactions) partes.push(`compactou ${u.compactions}×`)
  const custo = u.cost ? custoTexto(u.cost) : ''
  if (custo) partes.push(custo)
  if (u.coins !== undefined) partes.push(`🪙 ${u.coins}`)
  return partes.join(' · ')
}

const GRUPOS: ReadonlyArray<{ titulo: string; status: readonly string[] }> = [
  { titulo: 'Precisa de você', status: ['waiting'] },
  { titulo: 'Trabalhando', status: ['working'] },
  { titulo: 'Esperando um comando', status: ['shell'] },
  { titulo: 'Ociosas', status: ['idle'] },
]

export function porEstado(usage: readonly UsoAgente[]): Array<{ titulo: string; sessoes: UsoAgente[] }> {
  const saida: Array<{ titulo: string; sessoes: UsoAgente[] }> = []
  for (const g of GRUPOS) {
    const sessoes = usage.filter((u) => u.kind === 'main' && g.status.includes(u.status))
    if (sessoes.length) saida.push({ titulo: g.titulo, sessoes })
  }
  return saida
}

export function nomeDaLinha(u: UsoAgente, esperaPor?: string): string {
  const titulo = u.title ? ` · ${u.title.length > MAX_TITULO ? `${u.title.slice(0, MAX_TITULO)}…` : u.title}` : ''
  return `${u.name} · ${u.room}${titulo}${esperaPor ? ` · ${esperaPor}` : ''}`
}

/** As linhas do /escritorio: cada grupo com suas sessões (principais) e a própria sessão no fim. */
export function listaTexto(usage: readonly UsoAgente[], self: UsoAgente | undefined, esperaPor: ReadonlyMap<string, string> = new Map()): string[] {
  const linhas: string[] = []
  for (const g of porEstado(usage)) {
    linhas.push(`${g.titulo} (${g.sessoes.length})`)
    for (const u of g.sessoes) {
      linhas.push(`  ${nomeDaLinha(u, esperaPor.get(u.id))}`)
      const d = detalheTexto(u)
      if (d) linhas.push(`    ${d}`)
    }
  }
  const proprio = self ? detalheTexto(self) : ''
  if (proprio) linhas.push(`Esta sessão: ${proprio}`)
  return linhas
}

/** Id de agente principal = `<conta>:<pid>`; subagente (`<sessão>:<agente>`) e qualquer outra forma não têm pid. */
export function pidDoId(id: string): number | undefined {
  const m = /^[^:\s]+:([1-9]\d{0,9})$/.exec(id)
  const pid = m ? Number(m[1]) : undefined
  return pid !== undefined && Number.isSafeInteger(pid) ? pid : undefined
}

export function lerIr(textoJson: string): IrView | undefined {
  let j: unknown
  try {
    j = JSON.parse(textoJson)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined
  const r = j as Record<string, unknown>
  if ((r.estado !== 'vivo' && r.estado !== 'encerrado') || typeof r.comando !== 'string' || !r.comando || CONTROLE.test(r.comando)) return undefined
  const links: IrView['links'] = []
  if (Array.isArray(r.links)) {
    for (const l of r.links) {
      const x = l as Record<string, unknown> | null
      if (x && typeof x.href === 'string' && typeof x.rotulo === 'string') links.push({ rotulo: x.rotulo, href: x.href })
    }
  }
  const ir: IrView = { estado: r.estado, comando: r.comando, links }
  const origin = texto(r.origin)
  if (origin) ir.origin = origin
  const aviso = texto(r.aviso)
  if (aviso) ir.aviso = aviso
  if (typeof r.nonce === 'string' && NONCE.test(r.nonce)) ir.nonce = r.nonce
  return ir
}

export type Acao =
  | { tipo: 'app'; href: string }
  | { tipo: 'app-http'; href: string }
  | { tipo: 'focar' }
  | { tipo: 'copiar'; rotulo: string; comando: string; aviso?: string }
  | { tipo: 'comando'; comando: string; aviso?: string }

export interface PedidoDeAcoes {
  /** `e.surface` do painel: só `terminal` copia e abre com `$.process`. */
  superficie: string
  id: string
  porta: number
  ir: IrView
  /** O painel do terminal da sessão foi achado. */
  focavel: boolean
}

const LINK_APP = /^claude:\/\/code\/continue\?session=local_/

/** Sessão viva só tem `attach` ou a cópia por fork; `--resume` puro é de sessão encerrada. */
function comandoSeguro(ir: IrView): boolean {
  if (ir.estado === 'encerrado') return true
  return ir.comando.startsWith('claude attach ') || ir.comando.endsWith(' --fork-session')
}

export function acoesDaSessao(p: PedidoDeAcoes): Acao[] {
  const { ir } = p
  const terminal = p.superficie === 'terminal'
  const direto = ir.estado === 'vivo' ? ir.links.find((l) => LINK_APP.test(l.href) && argvAbrir(l.href))?.href : undefined
  if (direto) {
    if (terminal) return [{ tipo: 'app', href: direto }]
    if (ir.nonce) return [{ tipo: 'app-http', href: `http://localhost:${p.porta}/api/agentes/${encodeURIComponent(p.id)}/ir?abrir=1&n=${ir.nonce}` }]
  }
  if (!comandoSeguro(ir)) return []
  const acoes: Acao[] = []
  const attach = ir.comando.startsWith('claude attach ')
  if (terminal && ir.estado === 'vivo' && !attach && p.focavel) acoes.push({ tipo: 'focar' })
  if (!terminal) acoes.push({ tipo: 'comando', comando: ir.comando, ...(ir.aviso ? { aviso: ir.aviso } : {}) })
  else {
    const rotulo = ir.estado === 'encerrado' ? 'Copiar comando para retomar' : attach ? 'Copiar claude attach' : 'Copiar comando (cria uma cópia)'
    acoes.push({ tipo: 'copiar', rotulo, comando: ir.comando, ...(ir.aviso ? { aviso: ir.aviso } : {}) })
  }
  return acoes
}
