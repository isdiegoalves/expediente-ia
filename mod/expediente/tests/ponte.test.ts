// Testes da ponte do app desktop, rodados por `claude plugin test` dentro de mod/expediente. O sistema de
// arquivos é um mapa em memória; os dados do app são fictícios.
import type { On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { filtrarSessaoApp } from '../hooks/ponte'

const NOW = Date.parse('2026-10-09T12:00:00Z')
const HOME = '/home/fulano'
const APP = `${HOME}/Library/Application Support/Claude/claude-code-sessions`
const FINAL = `${HOME}/.expediente/host/sessoes-app.json`
const SENTINELA = 'SENTINELA-NAO-PODE-SAIR'
const START = { cwd: '/work', surface: 'terminal', isInteractive: true } as const

const UUID_A = '11111111-aaaa-4aaa-8aaa-111111111111'
const UUID_B = '22222222-bbbb-4bbb-8bbb-222222222222'

function sessaoDoApp(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sessionId: 'local_aaaa-1',
    cliSessionId: UUID_A,
    isArchived: false,
    title: `título ${SENTINELA}`,
    cwd: `/projetos/${SENTINELA}`,
    postTurnSummary: { texto: SENTINELA },
    sessionPermissionUpdates: [{ regra: SENTINELA }],
    remoteMcpServersConfig: { servidor: { token: SENTINELA } },
    bridgeSessionIds: [`session_${SENTINELA}`],
    ...over,
  })
}

describe('filtrarSessaoApp', () => {
  test('JSON do app com sentinela em title, postTurnSummary, sessionPermissionUpdates e remoteMcpServersConfig: a saída tem só as 3 chaves e nenhuma sentinela', async () => {
    const saida = filtrarSessaoApp(sessaoDoApp())
    expect(Object.keys(saida ?? {}).sort()).toEqual(['cliSessionId', 'isArchived', 'sessionId'])
    expect(JSON.stringify(saida)).not.toContain(SENTINELA)
    expect(saida).toEqual({ sessionId: 'local_aaaa-1', cliSessionId: UUID_A, isArchived: false })
  })

  test('sem cliSessionId a chave não existe; isArchived só é verdadeiro se for true', async () => {
    expect(filtrarSessaoApp(sessaoDoApp({ cliSessionId: undefined }))).toEqual({ sessionId: 'local_aaaa-1', isArchived: false })
    expect(filtrarSessaoApp(sessaoDoApp({ isArchived: 'true' }))?.isArchived).toBe(false)
    expect(filtrarSessaoApp(sessaoDoApp({ isArchived: true }))?.isArchived).toBe(true)
  })

  test('id fora do formato do app, JSON cortado ou que não é objeto: nada sai', async () => {
    expect(filtrarSessaoApp(sessaoDoApp({ sessionId: '../../etc' }))).toBeUndefined()
    expect(filtrarSessaoApp(sessaoDoApp({ sessionId: 42 }))).toBeUndefined()
    expect(filtrarSessaoApp(sessaoDoApp({ cliSessionId: `a/${SENTINELA}` }))?.cliSessionId).toBeUndefined()
    expect(filtrarSessaoApp(sessaoDoApp().slice(0, 40))).toBeUndefined()
    expect(filtrarSessaoApp('[]')).toBeUndefined()
    expect(filtrarSessaoApp('null')).toBeUndefined()
  })
})

interface Arquivo {
  text: string
  mtimeMs: number
}

function mundo(on: On, arquivos: Record<string, string>, opts: { semProcess?: boolean; env?: Record<string, string> } = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, opts.env ?? { HOME })
  const fs = new Map<string, Arquivo>(Object.entries(arquivos).map(([p, text]) => [p, { text, mtimeMs: NOW - 60_000 }]))
  const escritas: string[] = []
  const comandos: string[][] = []
  const leituras: string[] = []
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000, tokens: 1, percent: 0 }, rateLimits: [] } }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.status', () => ({ value: undefined }))
  on('http.fetch', () => ({ deny: 'ECONNREFUSED' }))
  on('fs.list', ($, e) => {
    const prefixo = `${e.path ?? ''}/`
    const entradas = new Map<string, 'file' | 'dir'>()
    for (const p of fs.keys()) {
      if (!p.startsWith(prefixo)) continue
      const resto = p.slice(prefixo.length)
      const [nome, ...mais] = resto.split('/')
      if (nome) entradas.set(nome, mais.length ? 'dir' : 'file')
    }
    if (!entradas.size) return { deny: 'ENOENT' }
    return { value: [...entradas].map(([name, kind]) => ({ name, kind, size: kind === 'file' ? fs.get(`${prefixo}${name}`)?.text.length ?? 0 : 0, mtimeMs: kind === 'file' ? fs.get(`${prefixo}${name}`)?.mtimeMs ?? 0 : 0, isLink: false })) }
  })
  on('fs.stat', ($, e) => {
    const a = fs.get(e.path)
    return a ? { value: { kind: 'file', size: a.text.length, mtimeMs: a.mtimeMs, isLink: false } } : { deny: 'ENOENT' }
  })
  on('fs.read', ($, e) => {
    leituras.push(e.path)
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
    if (e.argv[0] === 'mv' && e.argv[1] === '-f' && e.argv[2] && e.argv[3]) {
      const origem = fs.get(e.argv[2])
      if (!origem) return { value: { exitCode: 1, stdout: '', stderr: 'não existe', isStdoutTruncated: false, isStderrTruncated: false } }
      fs.set(e.argv[3], { text: origem.text, mtimeMs: clock.now() })
      fs.delete(e.argv[2])
    }
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { clock, fs, escritas, comandos, leituras, final: () => fs.get(FINAL)?.text }
}

const doApp = (nome: string, over: Record<string, unknown> = {}) => [`${APP}/conta-1/org-1/${nome}.json`, sessaoDoApp({ sessionId: nome, ...over })] as const

describe('ponte do app desktop', () => {
  test('grava sessoes-app.json só com as 3 chaves, sem sentinela, incluindo as arquivadas (o servidor decide)', async ($, on) => {
    const w = mundo(
      on,
      Object.fromEntries([
        doApp('local_um', { cliSessionId: UUID_A }),
        doApp('local_dois', { cliSessionId: UUID_B, isArchived: true }),
        doApp('local_tres', { cliSessionId: undefined }),
        [`${APP}/conta-1/org-1/outro.txt`, SENTINELA],
      ]),
    )
    await $.session.start(START)
    await w.clock.advance(5_000)
    const arquivo = JSON.parse(w.final() ?? 'null')
    expect(Object.keys(arquivo).sort()).toEqual(['geradoEm', 'sessoes'])
    expect(arquivo.geradoEm).toBe(NOW + 5_000)
    expect(arquivo.sessoes).toEqual([
      { sessionId: 'local_dois', cliSessionId: UUID_B, isArchived: true },
      { sessionId: 'local_tres', isArchived: false },
      { sessionId: 'local_um', cliSessionId: UUID_A, isArchived: false },
    ])
    expect(w.final()).not.toContain(SENTINELA)
  })

  test('a gravação troca o arquivo por mv, nunca escreve o final aos pedaços', async ($, on) => {
    const w = mundo(on, Object.fromEntries([doApp('local_um')]))
    await $.session.start(START)
    await w.clock.advance(5_000)
    expect(w.escritas.length).toBe(1)
    expect(w.escritas[0]).not.toBe(FINAL)
    expect(w.escritas[0]?.startsWith(`${FINAL}.`)).toBe(true)
    expect(w.escritas[0]?.endsWith('.tmp')).toBe(true)
    expect(w.comandos).toEqual([['mv', '-f', w.escritas[0] ?? '', FINAL]])
  })

  test('arquivo do app cortado não derruba a ponte: os outros saem', async ($, on) => {
    const w = mundo(on, Object.fromEntries([doApp('local_um'), [`${APP}/conta-1/org-1/local_cortado.json`, sessaoDoApp().slice(0, 50)]]))
    await $.session.start(START)
    await w.clock.advance(5_000)
    expect(JSON.parse(w.final() ?? 'null').sessoes.map((s: { sessionId: string }) => s.sessionId)).toEqual(['local_um'])
  })

  test('só relê o arquivo cujo tamanho ou data mudou', async ($, on) => {
    const w = mundo(on, Object.fromEntries([doApp('local_um'), doApp('local_dois', { cliSessionId: UUID_B })]))
    await $.session.start(START)
    await w.clock.advance(5_000)
    expect(w.leituras.length).toBe(2)
    await w.clock.advance(5_000)
    expect(w.leituras.length).toBe(2)
    const dois = `${APP}/conta-1/org-1/local_dois.json`
    w.fs.set(dois, { text: sessaoDoApp({ sessionId: 'local_dois', cliSessionId: UUID_A }), mtimeMs: NOW + 9_000 })
    await w.clock.advance(5_000)
    expect(w.leituras.length).toBe(3)
    expect(JSON.parse(w.final() ?? 'null').sessoes.find((s: { sessionId: string }) => s.sessionId === 'local_dois').cliSessionId).toBe(UUID_A)
  })

  test('arquivo final com menos de 4 s: a sessão pula a rodada', async ($, on) => {
    const w = mundo(on, Object.fromEntries([doApp('local_um'), [FINAL, '{}']]))
    w.fs.set(FINAL, { text: '{}', mtimeMs: NOW + 3_000 })
    await $.session.start(START)
    await w.clock.advance(5_000)
    expect(w.escritas).toEqual([])
    await w.clock.advance(5_000)
    expect(w.escritas.length).toBe(1)
  })

  test('sem $.process (sessão do app): não grava, não lança e não deixa o final pela metade', async ($, on) => {
    const w = mundo(on, Object.fromEntries([doApp('local_um')]), { semProcess: true })
    expect(await $.session.start(START)).toEqual({ cwd: '/work' })
    await w.clock.advance(5_000)
    expect(w.final()).toBeUndefined()
  })

  test('sem a pasta do app: não grava nada', async ($, on) => {
    const w = mundo(on, {})
    await $.session.start(START)
    await w.clock.advance(5_000)
    expect(w.escritas).toEqual([])
  })
})
