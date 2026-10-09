// Ponte do app desktop: lê os JSON de sessão do app e grava ~/.expediente/host/sessoes-app.json com 3 campos
// por sessão, que é o que o servidor (no container, sem acesso à pasta do app) enxerga. As chamadas a `$` ficam
// em register.ts: a análise do Claude Code não segue `$` por um import.
export const PONTE_MS = 5_000
/** Arquivo final gravado há menos que isto: outra sessão já fez a rodada. */
export const FRESCO_MS = 4_000

export interface SessaoApp {
  sessionId: string
  cliSessionId?: string
  isArchived: boolean
}

const ID_APP = /^local_[A-Za-z0-9-]{1,64}$/
const ID_CLI = /^[A-Za-z0-9-]{1,64}$/

/** As três chaves, escolhidas por nome: nada mais do JSON do app (título, caminho, tokens...) é copiado. */
export function filtrarSessaoApp(texto: string): SessaoApp | undefined {
  let j: unknown
  try {
    j = JSON.parse(texto)
  } catch {
    return undefined
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined
  const sessionId = (j as { sessionId?: unknown }).sessionId
  const cliSessionId = (j as { cliSessionId?: unknown }).cliSessionId
  const isArchived = (j as { isArchived?: unknown }).isArchived
  if (typeof sessionId !== 'string' || !ID_APP.test(sessionId)) return undefined
  const saida: SessaoApp = { sessionId, isArchived: isArchived === true }
  if (typeof cliSessionId === 'string' && ID_CLI.test(cliSessionId)) saida.cliSessionId = cliSessionId
  return saida
}

export function appDirOf(home: string): string {
  return `${home}/Library/Application Support/Claude/claude-code-sessions`
}

export function sessoesAppFileOf(home: string): string {
  return `${home}/.expediente/host/sessoes-app.json`
}
