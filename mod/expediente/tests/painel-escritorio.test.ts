// O painel do /escritorio: o caminho de cada sessão por superfície. Nada aqui abre link nem foca painel de verdade:
// `process.run` e `ui.copy` são simulados e o teste confere o argv que chegaria a eles.
import type { CommandRunInput, HttpResponse, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { chaveDoArquivo, provaDoServidor } from '../hooks/prova'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const PORTA = '4851'
const APP = 'claude://code/continue?session=local_11111111-2222-3333-4444-555555555555'
const FORK = 'claude --resume s-terminal --fork-session'
const AVISO = 'cria uma cópia, não responde à sessão original'
const RUN: CommandRunInput = { command: 'escritorio', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }
const SCROLL = { offset: 0, bodyRows: 10 }
const PANE = {
  plugin: 'expediente',
  component: 'Pane',
  requestId: 'escritorio',
  props: { title: 'Escritório', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: SCROLL, view: {} },
} as const
const TOKEN_LOCAL = 'ab'.repeat(32)
const DESAFIO = 'fedcba9876543210fedcba9876543210'
const RODOU = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

interface Sessao {
  id: string
  status?: string
  ir: Record<string, unknown>
}

const CLAUDE = '/Users/fulano/.local/bin/claude\n'
const ehPrograma = (argv: readonly string[]) => /^ps -o comm= -p \d+$/.test(argv.join(' '))

function nonce(n: number): string {
  return String(n).padStart(32, '0')
}

function resposta(texto: string): HttpResponse {
  return { status: 200, ok: true, headers: { 'content-type': 'application/json' }, text: texto }
}

interface Mundo {
  sessoes: Sessao[]
  superficies?: ReadonlyArray<'terminal' | 'desktop'>
  /** O que cada `process.run` devolve, pelo primeiro item do argv; o resto sai com 0 e sem texto. */
  processo?: (argv: readonly string[]) => Partial<typeof RODOU>
}

function mundo(on: On, m: Mundo) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/fulano', CLAUDE_CONFIG_DIR: '~/.claude', EXPEDIENTE_PORT: PORTA })
  const buscas: string[] = []
  const rodados: string[][] = []
  const copiados: string[] = []
  const avisos: string[] = []
  let emitidos = 0
  on('session.id', () => ({ value: 'sess-propria' }))
  on('session.surfaces', () => ({ value: m.superficies ?? ['terminal'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    avisos.push(e.text)
    return { value: undefined }
  })
  on('ui.copy', ($, e) => {
    copiados.push(e.text)
    return { value: { isCopied: true } }
  })
  on('process.run', ($, e) => {
    rodados.push([...e.argv])
    return { value: { ...RODOU, ...(m.processo?.(e.argv) ?? {}) } }
  })
  on('fs.read', (_$, e) => (e.path === '/home/fulano/.expediente/host/token' ? { value: `${TOKEN_LOCAL}\n` } : { deny: 'ENOENT' }))
  on('http.fetch', ($, e) => {
    if (e.url.includes('/api/token/desafio?n=')) return { value: resposta(JSON.stringify({ desafio: DESAFIO, prova: provaDoServidor(chaveDoArquivo(TOKEN_LOCAL)!, new URL(e.url).searchParams.get('n') ?? '') })) }
    if (e.url.endsWith('/api/mod/focos')) return { value: resposta('{"focos":[]}') }
    buscas.push(e.url)
    const ir = /\/api\/agentes\/([^/]+)\/ir$/.exec(e.url)
    if (ir) {
      const id = decodeURIComponent(ir[1] ?? '')
      const s = m.sessoes.find((x) => x.id === id)
      return { value: resposta(JSON.stringify({ ...s?.ir, nonce: nonce(++emitidos) })) }
    }
    const usage = m.sessoes.map((s) => ({ id: s.id, name: s.id.replace(/\W/g, ''), kind: 'main', status: s.status ?? 'idle', room: 'loja', compactions: 0 }))
    return { value: resposta(JSON.stringify({ version: '1', agents: usage.length, working: 0, waiting: [], usage })) }
  })
  return { clock, buscas, rodados, copiados, avisos, emitidos: () => emitidos }
}

describe('painel do /escritorio', () => {
  test('sessão do app, no app desktop: Link http://localhost com o nonce do /ir, sem botão e sem claude://', async ($, on) => {
    const w = mundo(on, { sessoes: [{ id: '.claude:11', ir: { estado: 'vivo', origin: 'app desktop', comando: FORK, aviso: AVISO, links: [{ rotulo: 'Abrir a sessão no app', href: APP }] } }] })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const link = await ui.find({ type: 'Link', text: /Abrir no app/ })
    expect(link?.props.href).toBe(`http://localhost:${PORTA}/api/agentes/.claude%3A11/ir?abrir=1&n=${nonce(1)}`)
    expect(await ui.find({ type: 'Button', text: /Abrir/ })).toBeUndefined()
    await ui.unmount()
    expect(w.rodados).toEqual([])
  })

  test('sessão do app, no terminal: Link claude:// e botão que roda open só com a URL da lista', async ($, on) => {
    const w = mundo(on, { sessoes: [{ id: '.claude:11', ir: { estado: 'vivo', origin: 'app desktop', comando: FORK, aviso: AVISO, links: [{ rotulo: 'Abrir a sessão no app', href: APP }] } }] })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Link', text: /Abrir no app/ }))?.props.href).toBe(APP)
    await ui.press({ key: 'abrir:.claude:11' })
    await ui.unmount()
    expect(w.rodados).toEqual([['open', APP]])
  })

  test('link do app com parâmetro a mais não vira Link nem botão, e nada roda', async ($, on) => {
    const w = mundo(on, { sessoes: [{ id: '.claude:11', ir: { estado: 'vivo', origin: 'app desktop', comando: FORK, aviso: AVISO, links: [{ rotulo: 'x', href: `${APP}&prompt=rm` }] } }] })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Link' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: /^Abrir$/ })).toBeUndefined()
    await ui.unmount()
    expect(w.rodados).toEqual([])
  })

  test('terminal viva com painel do zellij: Focar roda zellij e depois o WezTerm, e só ao apertar; a cópia vem rotulada', async ($, on) => {
    const w = mundo(on, {
      sessoes: [{ id: '.claude:507', ir: { estado: 'vivo', origin: 'terminal', comando: FORK, aviso: AVISO, links: [] } }],
      processo: (argv) => (ehPrograma(argv) ? { stdout: CLAUDE } : argv[0] === '/bin/sh' ? { stdout: 'ZELLIJ_PANE_ID=17\nZELLIJ_SESSION_NAME=main\n' } : {}),
    })
    await $.command.run(RUN)
    expect(w.rodados.map((a) => a[0])).toEqual(['ps', '/bin/sh'])
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ text: AVISO })).toBeDefined()
    expect(await ui.find({ type: 'Button', text: /Copiar comando \(cria uma cópia\)/ })).toBeDefined()
    await ui.press({ key: 'focar:.claude:507' })
    await ui.unmount()
    expect(w.rodados.slice(2)).toEqual([
      ['zellij', '--session', 'main', 'action', 'focus-pane-id', 'terminal_17'],
      ['open', '-a', 'WezTerm'],
    ])
    expect(w.copiados).toEqual([])
  })

  test('pid que não é mais o claude (reusado por outro programa): sem Focar, sem ler o painel, só a cópia', async ($, on) => {
    const w = mundo(on, {
      sessoes: [{ id: '.claude:507', ir: { estado: 'vivo', origin: 'terminal', comando: FORK, aviso: AVISO, links: [] } }],
      processo: (argv) => (ehPrograma(argv) ? { stdout: '-zsh\n' } : argv[0] === '/bin/sh' ? { stdout: 'ZELLIJ_PANE_ID=17\nZELLIJ_SESSION_NAME=main\n' } : {}),
    })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Button', text: /^Focar$/ })).toBeUndefined()
    expect(await ui.find({ type: 'Button', text: /Copiar comando/ })).toBeDefined()
    await ui.unmount()
    expect(w.rodados.map((a) => a[0])).toEqual(['ps'])
  })

  test('pid cujo programa não dá para conferir (ps falha): sem Focar', async ($, on) => {
    const w = mundo(on, {
      sessoes: [{ id: '.claude:507', ir: { estado: 'vivo', origin: 'terminal', comando: FORK, aviso: AVISO, links: [] } }],
      processo: (argv) => (ehPrograma(argv) ? { exitCode: 1 } : argv[0] === '/bin/sh' ? { stdout: 'ZELLIJ_PANE_ID=17\nZELLIJ_SESSION_NAME=main\n' } : {}),
    })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Button', text: /^Focar$/ })).toBeUndefined()
    await ui.unmount()
    expect(w.rodados.map((a) => a[0])).toEqual(['ps'])
  })

  test('foco que falha: avisa e copia o comando seguro', async ($, on) => {
    const w = mundo(on, {
      sessoes: [{ id: '.claude:507', ir: { estado: 'vivo', origin: 'terminal', comando: FORK, aviso: AVISO, links: [] } }],
      processo: (argv) => (ehPrograma(argv) ? { stdout: CLAUDE } : argv[0] === '/bin/sh' ? { stdout: 'ZELLIJ_PANE_ID=17\nZELLIJ_SESSION_NAME=main\n' } : argv[0] === 'zellij' ? { exitCode: 1 } : {}),
    })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'focar:.claude:507' })
    await ui.unmount()
    expect(w.rodados.some((a) => a[0] === 'open')).toBe(false)
    expect(w.copiados).toEqual([FORK])
    expect(w.avisos[0]).toMatch(/não achei o painel/)
  })

  test('ramo genérico: sem zellij, o tty vai para o osascript do app que está rodando', async ($, on) => {
    const w = mundo(on, {
      sessoes: [{ id: '.claude:508', ir: { estado: 'vivo', origin: 'terminal', comando: FORK, aviso: AVISO, links: [] } }],
      processo: (argv) => (ehPrograma(argv) ? { stdout: CLAUDE } : argv[0] === 'ps' ? { stdout: 'ttys005\n' } : argv[0] === 'pgrep' ? { exitCode: argv[2] === 'Terminal' ? 0 : 1 } : argv[0] === 'osascript' ? { stdout: 'ok\n' } : {}),
    })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'focar:.claude:508' })
    await ui.unmount()
    const depois = w.rodados.filter((a) => a[0] === 'pgrep' || a[0] === 'osascript')
    expect(depois.map((a) => a[0])).toEqual(['pgrep', 'osascript'])
    expect(depois[1]?.at(-1)).toBe('/dev/ttys005')
    expect(w.copiados).toEqual([])
  })

  test('sem painel nem tty: só a cópia do comando, e ela copia', async ($, on) => {
    const w = mundo(on, { sessoes: [{ id: '.claude:509', ir: { estado: 'vivo', origin: 'terminal', comando: FORK, aviso: AVISO, links: [] } }] })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Button', text: /^Focar$/ })).toBeUndefined()
    await ui.press({ key: 'copiar:.claude:509' })
    await ui.unmount()
    expect(w.copiados).toEqual([FORK])
  })

  test('no app desktop o comando seguro aparece num Code, sem botão de foco nem de cópia', async ($, on) => {
    const w = mundo(on, { superficies: ['desktop'], sessoes: [{ id: '.claude:510', ir: { estado: 'vivo', origin: 'terminal', comando: FORK, aviso: AVISO, links: [] } }] })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Code' }))?.props.source).toBe(FORK)
    expect(await ui.find({ type: 'Button' })).toBeUndefined()
    await ui.unmount()
    expect(w.rodados).toEqual([])
  })

  test('segundo plano: claude attach, sem Focar e sem ler painel', async ($, on) => {
    const w = mundo(on, { sessoes: [{ id: '.claude:511', ir: { estado: 'vivo', origin: 'segundo plano', comando: 'claude attach s-bg', links: [] } }] })
    await $.command.run(RUN)
    expect(w.rodados).toEqual([])
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Button', text: /^Focar$/ })).toBeUndefined()
    await ui.press({ key: 'copiar:.claude:511' })
    await ui.unmount()
    expect(w.copiados).toEqual(['claude attach s-bg'])
  })

  test('encerrada: cd e --resume sem fork; sessão viva nunca ganha --resume puro', async ($, on) => {
    const retomar = "cd -- '/p/loja' && claude --resume s-fim"
    const w = mundo(on, {
      sessoes: [
        { id: '.claude:512', status: 'idle', ir: { estado: 'encerrado', origin: 'terminal', comando: retomar, links: [] } },
        { id: '.claude:513', status: 'idle', ir: { estado: 'vivo', origin: 'terminal', comando: 'claude --resume s-vivo', links: [] } },
      ],
    })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'copiar:.claude:512' })
    expect(await ui.find({ key: 'copiar:.claude:513' })).toBeUndefined()
    await ui.unmount()
    expect(w.copiados).toEqual([retomar])
  })

  test('com o painel desenhado, o nonce renova a cada 15 s; fechado, para de perguntar', async ($, on) => {
    const w = mundo(on, { sessoes: [{ id: '.claude:11', ir: { estado: 'vivo', origin: 'app desktop', comando: FORK, aviso: AVISO, links: [{ rotulo: 'Abrir a sessão no app', href: APP }] } }] })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect(w.emitidos()).toBe(1)
    await w.clock.advance(15_000)
    expect(w.emitidos()).toBe(2)
    expect((await ui.find({ type: 'Link', text: /Abrir no app/ }))?.props.href).toContain(`n=${nonce(2)}`)
    await ui.unmount()
    await w.clock.advance(30_000)
    await w.clock.advance(30_000)
    expect(w.emitidos()).toBeLessThanOrEqual(5)
    const antes = w.emitidos()
    await w.clock.advance(60_000)
    expect(w.emitidos()).toBe(antes)
  })

  test('sessão sem tela (claude -p): só o texto, sem /ir, sem processo e sem painel', async ($, on) => {
    const w = mundo(on, { superficies: [], sessoes: [{ id: '.claude:11', ir: { estado: 'vivo', origin: 'terminal', comando: FORK, links: [] } }] })
    const out = await $.command.run(RUN)
    expect(out.text).toContain('Expediente 1')
    expect(w.buscas.every((u) => u.includes('/api/mod/summary'))).toBe(true)
    expect(w.rodados).toEqual([])
  })
})
