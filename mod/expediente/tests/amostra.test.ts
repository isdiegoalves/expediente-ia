// Testes do amostrador horário do registro de sessões. O sistema de arquivos e o `ps` são mapas em memória.
import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { arquivoAmostraOf, contarMix, marcadorAmostraOf, horaDe, nomePrograma, paiDe } from '../hooks/amostra'

const NOW = Date.parse('2026-10-09T12:10:00Z')
const HOME = '/home/fulano'
const SESSOES = `${HOME}/.claude/sessions`
const SENTINELA = 'SENTINELA-NAO-PODE-SAIR'
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

describe('funções puras', () => {
  test('contarMix junta entrypoint e kind e troca valor fora do formato por "outro"', async () => {
    expect(
      contarMix([
        { entrypoint: 'cli', kind: 'interactive' },
        { entrypoint: 'cli', kind: 'interactive' },
        { entrypoint: 'claude-desktop', kind: 'interactive' },
        { kind: 'background' },
        { entrypoint: `/x/${SENTINELA}`, kind: 'background' },
      ]),
    ).toEqual({ 'cli|interactive': 2, 'claude-desktop|interactive': 1, 'desconhecido|background': 1, 'outro|background': 1 })
  })

  test('nomePrograma guarda só o nome: sem caminho, sem hífen de login shell, sem argumento', async () => {
    expect(nomePrograma('/Users/fulano/.local/bin/claude')).toBe('claude')
    expect(nomePrograma('-zsh')).toBe('zsh')
    expect(nomePrograma('/Applications/WezTerm.app/Contents/MacOS/wezterm-gui')).toBe('wezterm-gui')
    expect(nomePrograma('/bin/sh -c segredo=1')).toBe('outro')
    expect(nomePrograma('')).toBe('outro')
  })

  test('paiDe lê "ppid comando" e recusa o resto', async () => {
    expect(paiDe('  4242 /bin/zsh\n')).toEqual({ ppid: 4242, nome: 'zsh' })
    expect(paiDe(' 1 /sbin/launchd')).toEqual({ ppid: 1, nome: 'launchd' })
    expect(paiDe('')).toBeUndefined()
    expect(paiDe('abc zsh')).toBeUndefined()
  })

  test('horaDe e o nome do arquivo', async () => {
    expect(horaDe(NOW)).toBe('2026-10-09T12')
    expect(arquivoAmostraOf(HOME, '2026-10-09T12', 'conta-1')).toBe(`${HOME}/.expediente/host/amostras/2026-10-09T12-conta-1.json`)
  })
})

interface Arquivo {
  text: string
  mtimeMs: number
}

const ARVORE: Record<number, string> = {
  100: '50 /Users/fulano/.local/bin/claude',
  200: '100 -zsh',
  300: '1 /Applications/WezTerm.app/Contents/MacOS/wezterm-gui',
}

function registro(over: Record<string, unknown>): string {
  return JSON.stringify({ sessionId: 's', cwd: `/projetos/${SENTINELA}`, name: SENTINELA, ...over })
}

function mundo(on: On, arquivos: Record<string, string>, opts: { semProcess?: boolean } = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME })
  const fs = new Map<string, Arquivo>(Object.entries(arquivos).map(([p, text]) => [p, { text, mtimeMs: NOW - 60_000 }]))
  const comandos: string[][] = []
  const escritas: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000, tokens: 1, percent: 0 }, rateLimits: [] } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.status', () => ({ value: undefined }))
  on('http.fetch', () => ({ deny: 'ECONNREFUSED' }))
  on('fs.list', ($, e) => {
    const prefixo = `${e.path ?? ''}/`
    const entradas = [...fs.keys()].filter((p) => p.startsWith(prefixo) && !p.slice(prefixo.length).includes('/')).map((p) => p.slice(prefixo.length))
    if (!entradas.length) return { deny: 'ENOENT' }
    return { value: entradas.map((name) => ({ name, kind: 'file' as const, size: 1, mtimeMs: NOW - 60_000, isLink: false })) }
  })
  on('fs.stat', ($, e) => {
    const a = fs.get(e.path)
    return a ? { value: { kind: 'file', size: a.text.length, mtimeMs: a.mtimeMs, isLink: false } } : { deny: 'ENOENT' }
  })
  on('fs.read', ($, e) => {
    const a = fs.get(e.path)
    return a ? { value: a.text } : { deny: 'ENOENT' }
  })
  on('fs.write', ($, e) => {
    escritas.push(e.path)
    fs.set(e.path, { text: e.text, mtimeMs: clock.now() })
    return { value: undefined }
  })
  on('process.run', ($, e) => {
    comandos.push([...e.argv])
    if (opts.semProcess) return { deny: 'sem process' }
    const saida = e.argv[0] === 'ps' ? ARVORE[Number(e.argv[e.argv.length - 1])] : undefined
    const ok = saida !== undefined
    return { value: { exitCode: ok ? 0 : 1, stdout: saida ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { clock, fs, comandos, escritas, amostra: (hora = '2026-10-09T12') => fs.get(arquivoAmostraOf(HOME, hora, '.claude'))?.text }
}

const REGISTROS = {
  [`${SESSOES}/200.json`]: registro({ pid: 200, kind: 'interactive', entrypoint: 'cli' }),
  [`${SESSOES}/300.json`]: registro({ pid: 300, kind: 'interactive', entrypoint: 'claude-desktop' }),
  [`${SESSOES}/999.json`]: registro({ pid: 999, kind: 'background', entrypoint: 'cli' }),
}

describe('amostrador horário', () => {
  test('grava só contagens e nomes de programa, sem sentinela, e ignora pid que já morreu', async ($, on) => {
    const w = mundo(on, REGISTROS)
    await $.session.start(START)
    await w.clock.advance(1_000)
    const texto = w.amostra() ?? ''
    expect(texto).not.toContain(SENTINELA)
    expect(texto).not.toContain('/')
    expect(JSON.parse(texto)).toEqual({
      hora: '2026-10-09T12',
      registro: { 'cli|interactive': 1, 'claude-desktop|interactive': 1 },
      programas: { zsh: 1, claude: 1, 'wezterm-gui': 1 },
    })
  })

  test('uma amostra por hora: a segunda rodada na mesma hora não regrava; na hora seguinte grava outra', async ($, on) => {
    const w = mundo(on, REGISTROS)
    await $.session.start(START)
    await w.clock.advance(1_000)
    await w.clock.advance(10 * 60_000)
    expect(w.escritas.length).toBe(1)
    await w.clock.advance(60 * 60_000)
    expect(w.escritas.length).toBe(2)
  })

  test('depois de 24 amostras da conta grava o marcador e para; sem o marcador volta a amostrar', async ($, on) => {
    const antigas = Object.fromEntries(
      Array.from({ length: 23 }, (_, i) => [arquivoAmostraOf(HOME, `2026-10-08T${String(i).padStart(2, '0')}`, '.claude'), '{}']),
    )
    const w = mundo(on, { ...REGISTROS, ...antigas })
    await $.session.start(START)
    await w.clock.advance(1_000)
    expect(w.escritas).toEqual([arquivoAmostraOf(HOME, '2026-10-09T12', '.claude'), marcadorAmostraOf(HOME, '.claude')])
    const comandos = w.comandos.length
    await w.clock.advance(60 * 60_000)
    expect(w.escritas.length).toBe(2)
    expect(w.comandos.length).toBe(comandos)
    w.fs.delete(marcadorAmostraOf(HOME, '.claude'))
    await w.clock.advance(60 * 60_000)
    expect(w.escritas.length).toBe(4)
  })

  test('o ps recebe só -o ppid=,comm= e -p <pid>, sem pedir argumentos nem ambiente', async ($, on) => {
    const w = mundo(on, REGISTROS)
    await $.session.start(START)
    await w.clock.advance(1_000)
    expect(w.comandos.length).toBeGreaterThan(0)
    for (const c of w.comandos) expect(c.slice(0, 4)).toEqual(['ps', '-o', 'ppid=,comm=', '-p'])
  })

  test('sem $.process (sessão do app) ou sem pasta de registro: não grava e não lança', async ($, on) => {
    const a = mundo(on, REGISTROS, { semProcess: true })
    await $.session.start(START)
    await a.clock.advance(1_000)
    expect(a.escritas).toEqual([])
  })

  test('sem a pasta de registro: não grava', async ($, on) => {
    const w = mundo(on, {})
    await $.session.start(START)
    await w.clock.advance(1_000)
    expect(w.escritas).toEqual([])
  })
})
