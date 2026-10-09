// Testes do mod do Expediente, rodados pelo próprio Claude Code: `claude plugin test` dentro de mod/expediente
// (sem sessão, sem login, sem rede). Os stubs respondem no lugar do Claude Code: env, relógio
// (mock.clock), $.session.usage, $.session.id, $.session.surfaces, $.fs.write, $.http.fetch e $.ui.status.
import type { CommandRunInput, HttpResponse, On, SessionRateLimit } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { UsoAgente } from '../hooks/escritorio'
import { configDirOf, FETCH_TIMEOUT_MS, normalizePath, OFFLINE_POLL_MS, POLL_MS, parseSummary, statusText, usageDirOf, windowOf, type Summary, type WaitingAgent } from '../hooks/register'

const NOW = Date.parse('2026-10-06T12:00:00Z')
const SEC = (iso: string) => Date.parse(iso) / 1_000
const PORT = '4850'
const SUMMARY_URL = `http://127.0.0.1:${PORT}/api/mod/summary`

const LIMITS: SessionRateLimit[] = [
  { kind: 'five_hour', percentUsed: 42, resetsAt: '2026-10-06T14:00:00Z' },
  { kind: 'seven_day', percentUsed: 15.5, resetsAt: '2026-10-09T23:00:00.000Z' },
  // limite de gasto de um gateway: não é limite do plano, fica de fora
  { kind: 'spend_limit', percentUsed: 120 },
]
const CONTEXT = { window: 200_000, tokens: 1_000, percent: 0.5 }

function waiting(name: string, room: string, over: Partial<WaitingAgent> = {}): WaitingAgent {
  return { id: `.claude:${name}`, name, room, account: '.claude', waitingFor: 'aprovar uma permissão', answerable: false, ...over }
}

function summary(list: WaitingAgent[], over: Partial<Summary> = {}): Summary {
  return { version: '0.3.0', agents: 7, working: 3, waiting: list, usage: [], ...over }
}

interface World {
  env?: Record<string, string>
  limits?: SessionRateLimit[]
  surfaces?: ReadonlyArray<'terminal' | 'desktop'>
  /** Resposta do Expediente: um resumo, 'offline' (conexão recusada), 'hang' (não responde) ou um HTTP cru. */
  answer?: () => Summary | 'offline' | 'hang' | { status: number; text: string }
  /** $.fs.write falha (pasta sem permissão, disco cheio...). */
  writeFails?: boolean
}

/** Registra todos os stubs (antes da primeira chamada em $, como o kit exige) e devolve o que foi capturado. */
function world(on: On, w: World = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, w.env ?? { HOME: '/home/fulano', CLAUDE_CONFIG_DIR: '~/.claude-conta2,/outra/pasta', EXPEDIENTE_PORT: PORT })
  const writes: Array<{ path: string; text: string }> = []
  const fetches: string[] = []
  const statuses: Array<string | undefined> = []
  const commands: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('command.register', ($, e) => {
    commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.usage', () => ({ value: { startedAt: NOW, context: CONTEXT, rateLimits: w.limits ?? LIMITS } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: w.surfaces ?? ['terminal'] }))
  on('fs.write', ($, e) => {
    if (w.writeFails) return { deny: 'EACCES: permissão negada' }
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.status', ($, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
  on('http.fetch', async ($, e) => {
    fetches.push(e.url)
    const a = w.answer ? w.answer() : summary([])
    if (a === 'offline') return { deny: 'connect ECONNREFUSED 127.0.0.1:4850' }
    if (a === 'hang') {
      await clock.sleep(60_000)
      return { deny: 'tarde demais' }
    }
    return { value: 'status' in a ? response(a.status, a.text) : response(200, JSON.stringify(a)) }
  })
  return { clock, writes, fetches, statuses, commands }
}

const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
/** /escritorio digitado no terminal (o kit pede a origem e onde a resposta aparece). */
const RUN: CommandRunInput = { command: 'escritorio', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }

function response(status: number, text: string): HttpResponse {
  return { status, ok: status >= 200 && status < 300, headers: { 'content-type': 'application/json' }, text }
}

describe('uso do plano', () => {
  test('session.start grava o arquivo no formato do tap, com source "mod"', async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.commands).toEqual(['escritorio'])
    expect(w.writes.length).toBe(1)
    expect(w.writes[0]?.path).toBe('/home/fulano/.expediente/host/uso/.claude-conta2.json')
    expect(w.writes[0]?.text.endsWith('}\n')).toBe(true)
    expect(JSON.parse(w.writes[0]?.text ?? '')).toEqual({
      accountId: '.claude-conta2',
      configDir: '/home/fulano/.claude-conta2',
      fetchedAt: NOW,
      five_hour: { utilization: 42, resets_at: SEC('2026-10-06T14:00:00Z') },
      seven_day: { utilization: 15.5, resets_at: SEC('2026-10-09T23:00:00Z') },
      source: 'mod',
    })
  })

  test('EXPEDIENTE_USAGE_DIR com ~ e, sem CLAUDE_CONFIG_DIR, a conta ~/.claude', async ($, on) => {
    const w = world(on, { env: { HOME: '/home/fulano', EXPEDIENTE_USAGE_DIR: '~/uso/' } })
    await $.session.measure({ context: CONTEXT, rateLimits: LIMITS, changed: ['rateLimits'] })
    expect(w.writes.map((x) => x.path)).toEqual(['/home/fulano/uso/.claude.json'])
    expect(JSON.parse(w.writes[0]?.text ?? '')).toMatchObject({ accountId: '.claude', configDir: '/home/fulano/.claude' })
  })

  test('session.measure: não regrava valores iguais em menos de 10 s; regrava se mudou ou depois disso', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await $.session.start(START)
    expect(w.writes.length).toBe(1)
    await w.clock.advance(5_000)
    await $.session.measure({ context: CONTEXT, rateLimits: LIMITS, changed: ['context'] })
    expect(w.writes.length).toBe(1)
    const moved: SessionRateLimit[] = [{ ...LIMITS[0]!, percentUsed: 43 }, LIMITS[1]!]
    await $.session.measure({ context: CONTEXT, rateLimits: moved, changed: ['rateLimits'] })
    expect(w.writes.length).toBe(2)
    expect(JSON.parse(w.writes[1]?.text ?? '')).toMatchObject({ fetchedAt: NOW + 5_000, five_hour: { utilization: 43 } })
    await w.clock.advance(10_000)
    await $.session.measure({ context: CONTEXT, rateLimits: moved, changed: ['cost'] })
    expect(w.writes.length).toBe(3)
    expect(JSON.parse(w.writes[2]?.text ?? '')).toMatchObject({ fetchedAt: NOW + 15_000 })
  })

  test('sem janela do plano (fora de assinatura, só spend_limit) não grava nada', async ($, on) => {
    const w = world(on, { limits: [] })
    await $.session.start(START)
    await $.session.measure({ context: CONTEXT, rateLimits: [{ kind: 'spend_limit', percentUsed: 80 }], changed: ['rateLimits'] })
    expect(w.writes).toEqual([])
  })

  test('falha ao gravar = silêncio: a sessão começa e o comando é registrado', async ($, on) => {
    const w = world(on, { writeFails: true })
    expect(await $.session.start(START)).toEqual({ cwd: '/work' })
    expect(await $.session.measure({ context: CONTEXT, rateLimits: LIMITS, changed: ['rateLimits'] })).toEqual({ changed: ['rateLimits'] })
    expect(w.commands).toEqual(['escritorio'])
    expect(w.writes).toEqual([])
  })
})

describe('linha embaixo do prompt', () => {
  test('ninguém, uma, várias pessoas (corta em 3 nomes); só chama $.ui.status quando o texto muda', async ($, on) => {
    let list: WaitingAgent[] = []
    const w = world(on, { answer: () => summary(list) })
    await $.session.start(START)
    expect(w.fetches).toEqual([])
    await w.clock.advance(POLL_MS)
    expect(w.fetches).toEqual([`${SUMMARY_URL}?account=.claude-conta2&session=sess-1`])
    expect(w.statuses).toEqual([undefined])
    list = [waiting('Valentina', 'loja-virtual')]
    await w.clock.advance(POLL_MS)
    expect(w.statuses.at(-1)).toBe('🏢 Valentina precisa de você em loja-virtual')
    await w.clock.advance(POLL_MS)
    expect(w.statuses.length).toBe(2)
    list = [waiting('Valentina', 'loja-virtual'), waiting('Elias', 'app-mobile')]
    await w.clock.advance(POLL_MS)
    expect(w.statuses.at(-1)).toBe('🏢 2 precisam de você: Valentina (loja-virtual), Elias (app-mobile)')
    list = [...list, waiting('Bia', 'site'), waiting('Caio', 'api'), waiting('Dora', 'docs')]
    await w.clock.advance(POLL_MS)
    expect(w.statuses.at(-1)).toBe('🏢 5 precisam de você: Valentina (loja-virtual), Elias (app-mobile), Bia (site) e mais 2')
    list = []
    await w.clock.advance(POLL_MS)
    expect(w.statuses.at(-1)).toBeUndefined()
    expect(w.statuses.length).toBe(5)
  })

  test('pior caso: o servidor só vê a espera 1 s depois do evento e a pergunta do mod acabou de passar; a linha sai em até 5 s', async ($, on) => {
    const VARREDURA_MS = 1_000
    const LIMITE_MS = 5_000
    let agora = 0
    const visivelApos = 2 * POLL_MS
    const w = world(on, { answer: () => summary(agora > visivelApos ? [waiting('Valentina', 'loja-virtual')] : []) })
    await $.session.start(START)
    const andar = async (ms: number) => {
      for (let t = 0; t < ms; t += 1_000) {
        agora += 1_000
        await w.clock.advance(1_000)
      }
    }
    await andar(visivelApos - VARREDURA_MS)
    expect(w.statuses.at(-1)).toBeUndefined()
    await andar(LIMITE_MS)
    expect(w.statuses.at(-1)).toBe('🏢 Valentina precisa de você em loja-virtual')
  })

  test('Expediente fora do ar: limpa a linha e recua para 30 s até voltar', async ($, on) => {
    let up = false
    const w = world(on, { answer: () => (up ? summary([waiting('Valentina', 'loja-virtual')]) : 'offline') })
    await $.session.start(START)
    await w.clock.advance(POLL_MS)
    expect(w.fetches.length).toBe(1)
    expect(w.statuses).toEqual([undefined])
    await w.clock.advance(OFFLINE_POLL_MS - 1)
    expect(w.fetches.length).toBe(1)
    up = true
    await w.clock.advance(1)
    expect(w.fetches.length).toBe(2)
    expect(w.statuses.at(-1)).toBe('🏢 Valentina precisa de você em loja-virtual')
    await w.clock.advance(POLL_MS)
    expect(w.fetches.length).toBe(3)
  })

  test('Expediente travado: desiste depois de 2 s e limpa a linha', async ($, on) => {
    let hang = false
    const w = world(on, { answer: () => (hang ? 'hang' : summary([waiting('Valentina', 'loja-virtual')])) })
    await $.session.start(START)
    await w.clock.advance(POLL_MS)
    expect(w.statuses).toEqual(['🏢 Valentina precisa de você em loja-virtual'])
    hang = true
    await w.clock.advance(POLL_MS)
    expect(w.statuses.length).toBe(1)
    await w.clock.advance(FETCH_TIMEOUT_MS)
    expect(w.statuses).toEqual(['🏢 Valentina precisa de você em loja-virtual', undefined])
  })

  test('sessão sem superfície (claude -p, SDK): nem pergunta ao Expediente', async ($, on) => {
    const w = world(on, { surfaces: [] })
    await $.session.start({ cwd: '/work', surface: null, isInteractive: false })
    await w.clock.advance(15_000)
    expect(w.fetches).toEqual([])
    expect(w.statuses).toEqual([undefined])
  })
})

describe('/escritorio', () => {
  test('no ar: contagem sem esta sessão e as sessões por estado, com contexto e custo; zero chamadas ao modelo', async ($, on) => {
    const usage: UsoAgente[] = [
      { id: '.claude:2', name: 'Valentina', kind: 'main', status: 'waiting', room: 'loja-virtual', title: 'Subir o deploy', compactions: 1, context: { tokens: 142_300, window: 1_000_000, percent: 14 }, cost: { usd: 4.5, estimated: true, unpriced: [] } },
      { id: '.claude:3', name: 'Elias', kind: 'main', status: 'waiting', room: 'app-mobile', compactions: 0 },
      { id: '.claude:4', name: 'Bia', kind: 'main', status: 'working', room: 'site', compactions: 0, cost: { usd: 2, estimated: false, unpriced: [] } },
    ]
    const w = world(on, {
      answer: () =>
        summary([waiting('Valentina', 'loja-virtual', { id: '.claude:2', answerable: true }), waiting('Elias', 'app-mobile', { id: '.claude:3', waitingFor: 'responder no terminal' })], {
          agents: 3,
          working: 1,
          usage,
          self: { id: '.claude:1', name: 'Eu', kind: 'main', status: 'working', room: 'aqui', compactions: 0, context: { tokens: 50_000, window: 200_000, percent: 25 } },
        }),
    })
    let modelo = 0
    on('model.complete', () => {
      modelo++
      return { deny: 'sem modelo' }
    })
    const out = await $.command.run(RUN)
    expect(modelo).toBe(0)
    expect(w.fetches[0]).toBe(`${SUMMARY_URL}?account=.claude-conta2&session=sess-1`)
    expect(out.text).toBe(
      [
        'Expediente 0.3.0 em http://localhost:4850',
        '3 agentes · 1 trabalhando · 2 precisam de você',
        'Precisa de você (2)',
        '  Valentina · loja-virtual · Subir o deploy · aprovar uma permissão (dá para responder pelo escritório)',
        '    contexto 142,3 k de 1 M (14%) · compactou 1× · US$ 4,50 (estimado)',
        '  Elias · app-mobile · responder no terminal',
        'Trabalhando (1)',
        '  Bia · site',
        '    US$ 2,00',
        'Esta sessão: contexto 50 k de 200 k (25%)',
      ].join('\n'),
    )
  })

  test('no ar e ninguém esperando', async ($, on) => {
    world(on, { answer: () => summary([], { agents: 1, working: 0 }) })
    const out = await $.command.run(RUN)
    expect(out.text).toBe('Expediente 0.3.0 em http://localhost:4850\n1 agente · 0 trabalhando · ninguém precisa de você')
  })

  test('fora do ar: diz como subir', async ($, on) => {
    world(on, { answer: () => 'offline' })
    const out = await $.command.run(RUN)
    expect(out.text).toBe('O Expediente não respondeu em http://localhost:4850. Para subir: npm run docker:up na pasta do Expediente.')
  })

  test('Expediente de antes do mod (404 "rota desconhecida"): pede para atualizar', async ($, on) => {
    world(on, { env: { HOME: '/home/fulano' }, answer: () => ({ status: 404, text: '{"error":"rota desconhecida"}' }) })
    const out = await $.command.run(RUN)
    expect(out.text).toMatch(/^O Expediente em http:\/\/localhost:4848 está numa versão sem a rota do mod/)
  })
})

describe('funções puras', () => {
  test('caminhos, conta e pasta de uso como o tap calcula', () => {
    expect(normalizePath('/a//b/./c/../d/')).toBe('/a/b/d')
    expect(configDirOf(' ~/.claude-conta2 , /x', '/home/f')).toBe('/home/f/.claude-conta2')
    expect(configDirOf(undefined, '/home/f/')).toBe('/home/f/.claude')
    expect(configDirOf('', undefined)).toBeUndefined()
    expect(usageDirOf(undefined, '/home/f')).toBe('/home/f/.expediente/host/uso')
    expect(usageDirOf(undefined, undefined)).toBeUndefined()
  })

  test('janela: percentual limitado a 0–100, reinício em segundos; data inválida fica de fora', () => {
    expect(windowOf({ kind: 'five_hour', percentUsed: 101.5, resetsAt: '2026-10-06T14:00:00.400Z' })).toEqual({ utilization: 100, resets_at: SEC('2026-10-06T14:00:00Z') })
    expect(windowOf({ kind: 'five_hour', percentUsed: 7, resetsAt: 'amanhã' })).toEqual({ utilization: 7 })
    expect(windowOf({ kind: 'five_hour', percentUsed: Number.NaN })).toBeUndefined()
  })

  test('resumo: formato estranho = fora do ar; textos viram uma linha só', () => {
    expect(parseSummary('<html>')).toBeUndefined()
    expect(parseSummary('{"version":"1"}')).toBeUndefined()
    const s = parseSummary(JSON.stringify({ version: '0.3.0', agents: 2, working: 1, waiting: [{ name: 'Ana\nB', room: 'r', answerable: 'sim' }, { room: 'sem nome' }] }))
    expect(s?.waiting).toEqual([{ id: 'Ana B', name: 'Ana B', room: 'r', account: '', waitingFor: 'responder no terminal', answerable: false }])
    expect(statusText([])).toBeUndefined()
  })
})
