// Pedidos de foco do navegador: o mod busca, assume e roda o mesmo plano do botão Focar. Nada aqui foca painel
// de verdade: `process.run` e `http.fetch` são simulados e o teste confere o argv e as chamadas que chegariam a eles.
import type { CommandRunInput, HttpResponse, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { FOCO_OFFLINE_MS, FOCO_POLL_MS } from '../hooks/foco'

const NOW = Date.parse('2026-10-10T12:00:00Z')
const PORTA = '4852'
const BASE = `http://127.0.0.1:${PORTA}`
const TOKEN = 'a'.repeat(32)
const CLAUDE = '/Users/fulano/.local/bin/claude\n'
const PAINEL_ZELLIJ = 'ZELLIJ_PANE_ID=17\nZELLIJ_SESSION_NAME=main\n'
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const
const RUN: CommandRunInput = { command: 'escritorio', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }
const PANE = {
  plugin: 'expediente',
  component: 'Pane',
  requestId: 'escritorio',
  props: { title: 'Escritório', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const RODOU = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const FOCO_ZELLIJ = [
  ['zellij', '--session', 'main', 'action', 'focus-pane-id', 'terminal_17'],
  ['open', '-a', 'WezTerm'],
]

interface Chamada {
  metodo: string
  url: string
  corpo?: string
}

interface Mundo {
  superficies?: ReadonlyArray<'terminal' | 'desktop'>
  /** Corpo de `GET /api/mod/focos`; 'offline' recusa a conexão. */
  pedidos?: () => unknown | 'offline'
  /** Status e corpo de `POST .../assumir`. */
  assumir?: { status: number; text: string }
  processo?: (argv: readonly string[]) => Partial<typeof RODOU>
}

function resposta(status: number, texto: string): HttpResponse {
  return { status, ok: status >= 200 && status < 300, headers: { 'content-type': 'application/json' }, text: texto }
}

function mundo(on: On, m: Mundo = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/fulano', CLAUDE_CONFIG_DIR: '~/.claude', EXPEDIENTE_PORT: PORTA })
  const chamadas: Chamada[] = []
  const rodados: string[][] = []
  const copiados: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000, tokens: 1, percent: 0 }, rateLimits: [] } }))
  on('session.id', () => ({ value: 'sess-propria' }))
  on('session.surfaces', () => ({ value: m.superficies ?? ['terminal'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.copy', (_$, e) => {
    copiados.push(e.text)
    return { value: { isCopied: true } }
  })
  on('process.run', (_$, e) => {
    rodados.push([...e.argv])
    return { value: { ...RODOU, ...(m.processo?.(e.argv) ?? {}) } }
  })
  on('http.fetch', (_$, e) => {
    const url = e.url.replace(BASE, '')
    if (url === '/api/mod/focos') {
      chamadas.push({ metodo: 'GET', url })
      const p = m.pedidos ? m.pedidos() : { focos: [] }
      return p === 'offline' ? { deny: 'connect ECONNREFUSED' } : { value: resposta(200, JSON.stringify(p)) }
    }
    if (url.endsWith('/assumir') || url.endsWith('/resultado')) {
      chamadas.push({ metodo: e.init?.method ?? 'GET', url, corpo: e.init?.body })
      const a = m.assumir ?? { status: 200, text: '{"pid":507}' }
      return { value: url.endsWith('/assumir') ? resposta(a.status, a.text) : resposta(200, '{"ok":true}') }
    }
    if (/\/ir$/.test(url)) {
      return { value: resposta(200, JSON.stringify({ estado: 'vivo', origin: 'terminal', comando: 'claude --resume s --fork-session', links: [], nonce: '0'.repeat(32) })) }
    }
    const usage = [{ id: '.claude:507', name: 'Ana', kind: 'main', status: 'idle', room: 'loja', compactions: 0 }]
    return { value: resposta(200, JSON.stringify({ version: '1', agents: 1, working: 0, waiting: [], usage })) }
  })
  return { clock, chamadas, rodados, copiados }
}

const noClaude = (argv: readonly string[]) => /^ps -o comm= -p \d+$/.test(argv.join(' '))
const comPainel = (argv: readonly string[]): Partial<typeof RODOU> => (noClaude(argv) ? { stdout: CLAUDE } : argv[0] === '/bin/sh' ? { stdout: PAINEL_ZELLIJ } : {})
const pedido = () => ({ focos: [{ token: TOKEN, pid: 507 }] })
const resultados = (w: { chamadas: Chamada[] }) => w.chamadas.filter((c) => c.url.endsWith('/resultado')).map((c) => c.corpo)

async function ligar($: { session: { start: (entrada: typeof START) => Promise<unknown> } }, w: { clock: { advance: (ms: number) => Promise<void> } }): Promise<void> {
  await $.session.start(START)
  await w.clock.advance(FOCO_POLL_MS)
}

describe('foco pedido pelo navegador', () => {
  test('assume o pedido, confere o claude, lê o painel filtrado e roda o plano do zellij; reporta focado', async ($, on) => {
    const w = mundo(on, { pedidos: pedido, processo: comPainel })
    await ligar($, w)
    expect(w.chamadas).toEqual([
      { metodo: 'GET', url: '/api/mod/focos' },
      { metodo: 'POST', url: `/api/mod/focos/${TOKEN}/assumir`, corpo: '{}' },
      { metodo: 'POST', url: `/api/mod/focos/${TOKEN}/resultado`, corpo: '{"resultado":"focado"}' },
    ])
    expect(w.rodados.filter((a) => !['mv', 'rm', 'pgrep'].includes(a[0] ?? '')).slice(0, 5)).toEqual([
      ['ps', '-o', 'comm=', '-p', '507'],
      ['/bin/sh', '-c', expect.stringContaining('ZELLIJ_'), 'leitor', '507'],
      ...FOCO_ZELLIJ,
    ])
  })

  test('pergunta a cada segundo', async ($, on) => {
    const w = mundo(on)
    await $.session.start(START)
    await w.clock.advance(999)
    expect(w.chamadas).toEqual([])
    await w.clock.advance(1)
    expect(w.chamadas).toEqual([{ metodo: 'GET', url: '/api/mod/focos' }])
    await w.clock.advance(1_000)
    expect(w.chamadas).toHaveLength(2)
  })

  test('só onde a sessão tem terminal', async ($, on) => {
    const w = mundo(on, { superficies: ['desktop'] })
    await ligar($, w)
    await w.clock.advance(3 * FOCO_POLL_MS)
    expect(w.chamadas).toEqual([])
  })

  test('pid que não é mais o claude: não lê o painel, não foca e reporta nao-e-claude', async ($, on) => {
    const w = mundo(on, { pedidos: pedido, processo: (argv) => (noClaude(argv) ? { stdout: '-zsh\n' } : argv[0] === '/bin/sh' ? { stdout: PAINEL_ZELLIJ } : {}) })
    await ligar($, w)
    expect(resultados(w)).toEqual(['{"resultado":"nao-e-claude"}'])
    expect(w.rodados.some((a) => a[0] === '/bin/sh' || a[0] === 'zellij' || a[0] === 'open')).toBe(false)
  })

  test('ps que falha: nao-e-claude, sem foco', async ($, on) => {
    const w = mundo(on, { pedidos: pedido, processo: (argv) => (noClaude(argv) ? { exitCode: 1 } : comPainel(argv)) })
    await ligar($, w)
    expect(resultados(w)).toEqual(['{"resultado":"nao-e-claude"}'])
    expect(w.rodados.some((a) => a[0] === 'zellij')).toBe(false)
  })

  test('pedido já assumido por outro mod: nada roda e nada é reportado', async ($, on) => {
    const w = mundo(on, { pedidos: pedido, processo: comPainel, assumir: { status: 409, text: '{"error":"já assumido"}' } })
    await ligar($, w)
    expect(w.chamadas.map((c) => c.url)).toEqual(['/api/mod/focos', `/api/mod/focos/${TOKEN}/assumir`])
    expect(w.rodados.some((a) => a[0] === 'ps' && a[1] === '-o')).toBe(false)
  })

  for (const texto of ['{"pid":"507; rm -rf /"}', '{"pid":0}', '{"pid":-3}', '{"pid":1.5}', '{"argv":["rm"]}', 'não é json']) {
    test(`o servidor só entrega o pid inteiro positivo: ${texto} não roda nada`, async ($, on) => {
      const w = mundo(on, { pedidos: pedido, processo: comPainel, assumir: { status: 200, text: texto } })
      await ligar($, w)
      expect(w.rodados.some((a) => a[0] === 'ps' && a[1] === '-o' && a[2] === 'comm=')).toBe(false)
      expect(resultados(w)).toEqual([])
    })
  }

  test('pedido com token ou pid malformado na lista é ignorado', async ($, on) => {
    const w = mundo(on, { pedidos: () => ({ focos: [{ token: '../x', pid: 507 }, { token: TOKEN, pid: '507' }, { token: TOKEN, pid: 0 }, null] }), processo: comPainel })
    await ligar($, w)
    expect(w.chamadas.map((c) => c.url)).toEqual(['/api/mod/focos'])
  })

  test('sem painel do zellij nem tty: reporta sem-painel e não roda foco', async ($, on) => {
    const w = mundo(on, { pedidos: pedido, processo: (argv) => (noClaude(argv) ? { stdout: CLAUDE } : argv[0] === 'ps' ? { stdout: '??\n' } : {}) })
    await ligar($, w)
    expect(resultados(w)).toEqual(['{"resultado":"sem-painel"}'])
    expect(w.rodados.some((a) => a[0] === 'zellij' || a[0] === 'open' || a[0] === 'osascript')).toBe(false)
  })

  test('zellij que falha: sem-painel e o WezTerm não é trazido', async ($, on) => {
    const w = mundo(on, { pedidos: pedido, processo: (argv) => (argv[0] === 'zellij' ? { exitCode: 1 } : comPainel(argv)) })
    await ligar($, w)
    expect(resultados(w)).toEqual(['{"resultado":"sem-painel"}'])
    expect(w.rodados.some((a) => a[0] === 'open')).toBe(false)
  })

  test('Expediente fora do ar: recua para 10 s antes de perguntar de novo', async ($, on) => {
    const w = mundo(on, { pedidos: () => 'offline' })
    await ligar($, w)
    expect(w.chamadas).toHaveLength(1)
    await w.clock.advance(FOCO_OFFLINE_MS - 2 * FOCO_POLL_MS)
    expect(w.chamadas).toHaveLength(1)
    await w.clock.advance(2 * FOCO_POLL_MS)
    expect(w.chamadas.length).toBeGreaterThan(1)
  })

  test('o botão Focar do painel e o pedido do navegador rodam o mesmo plano de foco', async ($, on) => {
    const w = mundo(on, { pedidos: pedido, processo: comPainel })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    const antesBotao = w.rodados.length
    await ui.press({ key: 'focar:.claude:507' })
    const doBotao = w.rodados.slice(antesBotao)
    await ui.unmount()
    await ligar($, w)
    const doPedido = w.rodados.filter((a) => a[0] === 'zellij' || a[0] === 'open')
    expect(doBotao).toEqual(FOCO_ZELLIJ)
    expect(doPedido).toEqual([...FOCO_ZELLIJ, ...FOCO_ZELLIJ])
  })
})
