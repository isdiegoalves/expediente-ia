// Amostra horária do registro de sessões: quantas sessões há por `entrypoint × kind` e quais programas aparecem na
// cadeia de processos pai delas. Grava só contagens e nomes de programa. As chamadas a `$` ficam em register.ts.
export const AMOSTRA_MS = 10 * 60_000
export const MAX_PIDS = 50
export const MAX_NIVEIS = 8

export interface EntradaRegistro {
  pid: number
  entrypoint?: string
  kind?: string
}

const ROTULO = /^[A-Za-z0-9._-]{1,40}$/

function rotulo(v: unknown): string {
  if (v === undefined) return 'desconhecido'
  return typeof v === 'string' && ROTULO.test(v) ? v : 'outro'
}

/** Só pid, entrypoint e kind: título, pasta e o resto do registro não são lidos. */
export function lerEntradaRegistro(texto: string): EntradaRegistro | undefined {
  let j: unknown
  try {
    j = JSON.parse(texto)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined
  const { pid, entrypoint, kind } = j as { pid?: unknown; entrypoint?: unknown; kind?: unknown }
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 1) return undefined
  const e: EntradaRegistro = { pid }
  if (typeof entrypoint === 'string') e.entrypoint = entrypoint
  if (typeof kind === 'string') e.kind = kind
  return e
}

export function contarMix(entradas: ReadonlyArray<{ entrypoint?: string; kind?: string }>): Record<string, number> {
  const mix: Record<string, number> = {}
  for (const e of entradas) {
    const chave = `${rotulo(e.entrypoint)}|${rotulo(e.kind)}`
    mix[chave] = (mix[chave] ?? 0) + 1
  }
  return mix
}

/** Último trecho do caminho do executável, sem o hífen de login shell. Qualquer coisa com espaço ou argumento vira "outro". */
export function nomePrograma(comm: string): string {
  const nome = (comm.trim().split('/').pop() ?? '').replace(/^-/, '')
  return ROTULO.test(nome) ? nome : 'outro'
}

export function argvPaiDe(pid: number): string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('pid inválido')
  return ['ps', '-o', 'ppid=,comm=', '-p', String(pid)]
}

/** Saída de `ps -o ppid=,comm=`: o pai e o nome do programa do próprio processo. */
export function paiDe(saida: string): { ppid: number; nome: string } | undefined {
  const m = /^\s*(\d+)\s+(\S.*)$/m.exec(saida)
  if (!m) return undefined
  const ppid = Number(m[1])
  if (!Number.isSafeInteger(ppid)) return undefined
  return { ppid, nome: nomePrograma(m[2] ?? '') }
}

export function contarProgramas(nomes: readonly string[]): Record<string, number> {
  const programas: Record<string, number> = {}
  for (const n of nomes) programas[n] = (programas[n] ?? 0) + 1
  return programas
}

export function horaDe(ms: number): string {
  return new Date(ms).toISOString().slice(0, 13)
}

export function arquivoAmostraOf(home: string, hora: string, conta: string): string {
  return `${pastaAmostrasOf(home)}/${hora}-${conta}.json`
}

export const MAX_AMOSTRAS = 24

export function pastaAmostrasOf(home: string): string {
  return `${home}/.expediente/host/amostras`
}

/** Existe depois da 24ª amostra da conta; apagar este arquivo religa o amostrador. */
export function marcadorAmostraOf(home: string, conta: string): string {
  return `${pastaAmostrasOf(home)}/concluido-${conta}`
}

export function ehAmostraDaConta(nome: string, conta: string): boolean {
  return nome.endsWith(`-${conta}.json`)
}
