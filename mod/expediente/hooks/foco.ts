// Pedidos de foco que o navegador registra no Expediente. Aqui só se lê o que o servidor devolve; o mod nunca
// executa nada que venha dele além de um pid inteiro entregue às funções de painel.ts.

export const FOCO_POLL_MS = 1_000
/** Expediente fora do ar ou sem a rota: recua para este intervalo antes de perguntar de novo. */
export const FOCO_OFFLINE_MS = 10_000

export type ResultadoFoco = 'focado' | 'sem-painel' | 'nao-e-claude'

export interface PedidoFoco {
  token: string
  pid: number
}

const TOKEN = /^[0-9a-f]{32}$/

function pidInteiro(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : undefined
}

function json(texto: string): unknown {
  try {
    return JSON.parse(texto)
  } catch {
    return undefined
  }
}

export function lerPedidos(texto: string): PedidoFoco[] {
  const lista = (json(texto) as { focos?: unknown } | undefined)?.focos
  if (!Array.isArray(lista)) return []
  const pedidos: PedidoFoco[] = []
  for (const p of lista) {
    const token = (p as { token?: unknown } | null)?.token
    const pid = pidInteiro((p as { pid?: unknown } | null)?.pid)
    if (typeof token === 'string' && TOKEN.test(token) && pid !== undefined) pedidos.push({ token, pid })
  }
  return pedidos
}

export function lerPidAssumido(texto: string): number | undefined {
  return pidInteiro((json(texto) as { pid?: unknown } | undefined)?.pid)
}
