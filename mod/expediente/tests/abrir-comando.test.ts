// `/escritorio abrir`: o mesmo caminho do botão "Abrir o escritório", sem o modelo. A saída de texto entra no transcript: nunca o
// bilhete, a URL nem o caminho do arquivo. Nada aqui abre navegador: `process.run`, `fs.write` e `http.fetch` são simulados.
import type { CommandRunInput, HttpResponse, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { htmlDoEscritorio } from '../hooks/abrir'
import { chaveDoArquivo, provaDoServidor } from '../hooks/prova'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const PORTA = '4854'
const TOKEN = '5e17e11a'.repeat(8)
const BILHETE = '00112233445566778899aabbccddeeff'
const DESAFIO = 'fedcba9876543210fedcba9876543210'
const PASTA = '/var/folders/ab/cdef_gh/T/expediente-abrir.XXXXXXXX.aBcD1234'
const ARQUIVO = `${PASTA}/abrir.html`
const COMANDO = 'node ~/.expediente/mod-instalado/scripts/abrir.mjs'
const RUN = (args: string): CommandRunInput => ({ command: 'escritorio', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })
const RODOU = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const FIM = { reason: 'other', sessionId: 'sess-propria', resume: { id: 'sess-propria' } } as const

interface Mundo {
  superficies?: ReadonlyArray<'terminal' | 'desktop'>
  token?: string
  tokenDoServidor?: string
  offline?: boolean
  openFalha?: boolean
}

function mundo(on: On, m: Mundo = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/fulano', CLAUDE_CONFIG_DIR: '~/.claude', EXPEDIENTE_PORT: PORTA })
  const rodados: string[][] = []
  const escritos: string[] = []
  const brutos: string[] = []
  on('session.id', () => ({ value: 'sess-propria' }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.surfaces', () => ({ value: m.superficies ?? [] }))
  on('fs.read', (_$, e) => (e.path === '/home/fulano/.expediente/host/token' && (m.token ?? TOKEN) !== 'ausente' ? { value: `${m.token ?? TOKEN}\n` } : { deny: 'ENOENT' }))
  on('fs.write', (_$, e) => {
    escritos.push(e.text)
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    rodados.push([...e.argv])
    if (e.argv[0] === 'mktemp') return { value: { ...RODOU, stdout: `${PASTA}\n` } }
    if (e.argv[0] === 'open' && m.openFalha) return { deny: 'sem permissão' }
    return { value: RODOU }
  })
  on('http.fetch', (_$, e) => {
    brutos.push(JSON.stringify([e.url, e.init ?? null]))
    if (m.offline) return { deny: 'connect ECONNREFUSED' }
    const resposta = (texto: string): { value: HttpResponse } => ({ value: { status: 200, ok: true, headers: {}, text: texto } })
    if (e.url.includes('/api/token/desafio?n=')) return resposta(JSON.stringify({ desafio: DESAFIO, prova: provaDoServidor(chaveDoArquivo(m.tokenDoServidor ?? TOKEN)!, new URL(e.url).searchParams.get('n') ?? '') }))
    if (e.url.endsWith('/api/token/bilhete')) return resposta(JSON.stringify({ bilhete: BILHETE }))
    return resposta('{}')
  })
  return { clock, rodados, escritos, brutos }
}

const semNada = (texto: string) => {
  for (const proibido of [TOKEN, BILHETE, '127.0.0.1', 'http://', '#b=', PASTA, 'abrir.html', 'expediente-abrir']) expect(texto, proibido).not.toContain(proibido)
}

describe('/escritorio abrir', () => {
  test('faz o que o botão faz, diz só que abriu, e nada do bilhete, da URL ou do caminho chega ao texto nem ao argv', async ($, on) => {
    const w = mundo(on)
    const r = (await $.command.run(RUN('abrir'))) as { text: string }
    expect(r.text).toBe('Abri o escritório no navegador, já autorizado.')
    semNada(r.text)
    expect(w.rodados).toEqual([['mktemp', '-d', '-t', 'expediente-abrir.XXXXXXXX'], ['chmod', '600', ARQUIVO], ['open', ARQUIVO]])
    expect(w.escritos).toEqual([htmlDoEscritorio(`http://127.0.0.1:${PORTA}/#b=${BILHETE}`)])
    expect(JSON.stringify(w.rodados)).not.toContain(BILHETE)
    expect(JSON.stringify(w.rodados)).not.toContain(TOKEN)
    expect(w.brutos.join('\n')).not.toContain(TOKEN)
  })

  test('arquivo e pasta somem aos 60 s com rm -f e rmdir, nada de rm -rf', async ($, on) => {
    const w = mundo(on)
    await $.command.run(RUN('abrir'))
    await w.clock.advance(59_000)
    expect(w.rodados.some((a) => a[0] === 'rm' || a[0] === 'rmdir')).toBe(false)
    await w.clock.advance(1_000)
    expect(w.rodados.filter((a) => a[0] === 'rm' || a[0] === 'rmdir')).toEqual([['rm', '-f', ARQUIVO], ['rmdir', PASTA]])
    expect(JSON.stringify(w.rodados)).not.toContain('-rf')
  })

  test('servidor que não prova ter o token: não abre, não grava, e explica', async ($, on) => {
    const w = mundo(on, { tokenDoServidor: 'f'.repeat(64) })
    const r = (await $.command.run(RUN('abrir'))) as { text: string }
    expect(r.text).toContain(`Quem responde na porta ${PORTA} não é o seu Expediente`)
    expect(w.rodados).toEqual([])
    expect(w.escritos).toEqual([])
    expect(w.brutos.join('\n')).not.toContain(TOKEN)
    semNada(r.text)
  })

  test('Expediente fora do ar: não abre e diz o que fazer', async ($, on) => {
    const w = mundo(on, { offline: true })
    const r = (await $.command.run(RUN('abrir'))) as { text: string }
    expect(r.text).toContain('npm run docker:up')
    expect(w.rodados).toEqual([])
    semNada(r.text)
  })

  test('sem o arquivo do token: o mesmo aviso', async ($, on) => {
    const w = mundo(on, { token: 'ausente' })
    const r = (await $.command.run(RUN('abrir'))) as { text: string }
    expect(r.text).toContain('npm run docker:up')
    expect(w.rodados).toEqual([])
  })

  test('onde $.process não roda (app desktop): só o comando que roda de qualquer pasta, sem bilhete nem arquivo', async ($, on) => {
    const w = mundo(on, { superficies: ['desktop'] })
    const r = (await $.command.run(RUN('abrir'))) as { text: string }
    expect(r.text).toContain(COMANDO)
    expect(w.rodados).toEqual([])
    expect(w.escritos).toEqual([])
    expect(w.brutos).toEqual([])
    semNada(r.text.replace(COMANDO, ''))
  })

  test('open que falha: apaga o que criou na hora, e a resposta manda rodar o comando, sem o caminho', async ($, on) => {
    const w = mundo(on, { openFalha: true })
    const r = (await $.command.run(RUN('abrir'))) as { text: string }
    expect(r.text).toContain(COMANDO)
    expect(w.rodados.filter((a) => a[0] === 'rm' || a[0] === 'rmdir')).toEqual([['rm', '-f', ARQUIVO], ['rmdir', PASTA]])
    semNada(r.text.replace(COMANDO, ''))
  })

  test('se a sessão acaba antes dos 60 s: o que já tem 15 s é apagado no session.end (aos 14 s ainda não); o mais novo fica (o navegador pode não ter lido o HTML)', async ($, on) => {
    const w = mundo(on)
    await $.command.run(RUN('abrir'))
    await $.session.end(FIM)
    expect(w.rodados.some((a) => a[0] === 'rm' || a[0] === 'rmdir')).toBe(false)
    // O limiar é de 15 s: aos 14 s o navegador ainda pode não ter lido o HTML (o claude -p acaba logo depois do open); aos 15 s já leu.
    await w.clock.advance(14_000)
    await $.session.end(FIM)
    expect(w.rodados.some((a) => a[0] === 'rm' || a[0] === 'rmdir')).toBe(false)
    await w.clock.advance(1_000)
    await $.session.end(FIM)
    expect(w.rodados.filter((a) => a[0] === 'rm' || a[0] === 'rmdir')).toEqual([['rm', '-f', ARQUIVO], ['rmdir', PASTA]])
    await w.clock.advance(60_000)
    expect(w.rodados.filter((a) => a[0] === 'rm')).toHaveLength(1)
  })

  test('os outros argumentos seguem como antes: nada de mktemp nem de open', async ($, on) => {
    const w = mundo(on, { offline: true })
    await $.command.run(RUN(''))
    await $.command.run(RUN('resumo'))
    expect(w.rodados.some((a) => a[0] === 'mktemp' || a[0] === 'open')).toBe(false)
  })
})
