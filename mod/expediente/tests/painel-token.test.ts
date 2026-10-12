// "Abrir o escritório" no painel do /escritorio: no terminal, um botão que grava o bilhete de uso único num HTML de pasta temporária e
// roda `open` só com o caminho. O token e o bilhete nunca vão para argv, texto, aviso nem status. Nada aqui abre navegador:
// `process.run`, `fs.write` e `http.fetch` são simulados.
import type { CommandRunInput, HttpResponse, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { chaveDoArquivo, provaDoCliente, provaDoServidor } from '../hooks/prova'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const PORTA = '4853'
const TOKEN = '5e17e11a'.repeat(8)
const BILHETE = '00112233445566778899aabbccddeeff'
const DESAFIO = 'fedcba9876543210fedcba9876543210'
const URL_DO_ESCRITORIO = `http://127.0.0.1:${PORTA}/#b=${BILHETE}`
const PASTA = '/var/folders/ab/cdef_gh/T/expediente-abrir.XXXXXXXX.aBcD1234'
const ARQUIVO = `${PASTA}/abrir.html`
const RUN: CommandRunInput = { command: 'escritorio', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }
const PANE = {
  plugin: 'expediente',
  component: 'Pane',
  requestId: 'escritorio',
  props: { title: 'Escritório', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const RODOU = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

function resposta(texto: string, status = 200): HttpResponse {
  return { status, ok: status < 300, headers: { 'content-type': 'application/json' }, text: texto }
}

interface Mundo {
  /** Conteúdo do arquivo do token; undefined = não existe. */
  token?: string
  /** O token que o servidor tem; diferente do arquivo = quem ocupa a porta não é o Expediente. */
  tokenDoServidor?: string
  mktemp?: string
  chmod?: number
}

function mundo(on: On, m: Mundo = {}) {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/fulano', CLAUDE_CONFIG_DIR: '~/.claude', EXPEDIENTE_PORT: PORTA })
  const rodados: string[][] = []
  const escritos: Array<{ path: string; text: string }> = []
  const saidas: string[] = []
  const brutos: string[] = []
  const pedidos: Array<{ url: string; valida: boolean }> = []
  let bilhetes = 0
  on('session.id', () => ({ value: 'sess-propria' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_$, e) => {
    saidas.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => (m.token !== undefined && e.path === '/home/fulano/.expediente/host/token' ? { value: `${m.token}\n` } : { deny: 'ENOENT' }))
  on('fs.write', (_$, e) => {
    escritos.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('process.run', (_$, e) => {
    rodados.push([...e.argv])
    if (e.argv[0] === 'mktemp') return { value: { ...RODOU, stdout: `${m.mktemp ?? PASTA}\n` } }
    if (e.argv[0] === 'chmod') return { value: { ...RODOU, exitCode: m.chmod ?? 0 } }
    return { value: RODOU }
  })
  on('http.fetch', (_$, e) => {
    brutos.push(JSON.stringify([e.url, e.init ?? null]))
    if (e.url.includes('/api/token/desafio?n=')) {
      const n = new URL(e.url).searchParams.get('n') ?? ''
      return { value: resposta(JSON.stringify({ desafio: DESAFIO, prova: provaDoServidor(chaveDoArquivo(m.tokenDoServidor ?? TOKEN)!, n) })) }
    }
    if (e.url.endsWith('/api/token/bilhete')) {
      const url = '/api/token/bilhete'
      pedidos.push({ url, valida: e.init?.headers?.['x-expediente-prova'] === `${DESAFIO}.${provaDoCliente(chaveDoArquivo(TOKEN)!, DESAFIO, 'POST', url)}` })
      bilhetes++
      return { value: resposta(JSON.stringify({ bilhete: BILHETE })) }
    }
    if (e.url.includes('/api/mod/focos')) return { value: resposta('{"focos":[]}') }
    const usage = [{ id: '.claude:11', name: 'Ana', kind: 'main', status: 'idle', room: 'loja', compactions: 0 }]
    return { value: resposta(JSON.stringify({ version: '1', agents: 1, working: 0, waiting: [], usage })) }
  })
  return { clock, rodados, escritos, saidas, brutos, pedidos, bilhetes: () => bilhetes }
}

const semSegredo = (texto: string) => {
  expect(texto).not.toContain(TOKEN)
  expect(texto).not.toContain(BILHETE)
}

describe('"Abrir o escritório" no terminal', () => {
  test('botão que grava o HTML com o bilhete numa pasta temporária, roda open só com o caminho e apaga a pasta quando o bilhete vence', async ($, on) => {
    const w = mundo(on, { token: TOKEN })
    const texto = (await $.command.run(RUN)) as { text?: string }
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect(await ui.find({ type: 'Link', text: /Abrir o escritório/ })).toBeUndefined()
    expect(await ui.findAll({ text: new RegExp(`${TOKEN}|${BILHETE}`) })).toEqual([])
    expect(w.bilhetes()).toBe(0)
    await ui.press({ key: 'abrir-escritorio' })
    await ui.unmount()
    expect(w.bilhetes()).toBe(1)
    expect(w.pedidos).toEqual([{ url: '/api/token/bilhete', valida: true }])
    expect(w.rodados.filter((a) => ['mktemp', 'chmod', 'open', 'rm'].includes(a[0]!))).toEqual([['mktemp', '-d', '-t', 'expediente-abrir.XXXXXXXX'], ['chmod', '600', ARQUIVO], ['open', ARQUIVO]])
    expect(w.escritos).toHaveLength(1)
    expect(w.escritos[0]!.path).toBe(ARQUIVO)
    expect(w.escritos[0]!.text).toContain(URL_DO_ESCRITORIO)
    expect(w.escritos[0]!.text).not.toContain(TOKEN)
    semSegredo(JSON.stringify(w.rodados))
    semSegredo(texto.text ?? '')
    semSegredo(w.saidas.join('\n'))
    await w.clock.advance(59_000)
    expect(w.rodados.some((a) => a[0] === 'rm')).toBe(false)
    await w.clock.advance(1_000)
    expect(w.rodados.filter((a) => a[0] === 'rm')).toEqual([['rm', '-rf', PASTA]])
  })

  test('o token em claro nunca sai: nem na prova de cliente, nem na URL, nem no corpo, nem no cabeçalho', async ($, on) => {
    const w = mundo(on, { token: TOKEN })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'abrir-escritorio' })
    await ui.unmount()
    expect(w.brutos.join('\n')).not.toContain(TOKEN)
  })

  test('servidor que não prova ter o token (quem ocupa a porta): nenhum bilhete, nenhuma pasta, nenhum open, e o aviso diz quem não é quem', async ($, on) => {
    const w = mundo(on, { token: TOKEN, tokenDoServidor: 'f'.repeat(64) })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'abrir-escritorio' })
    await ui.unmount()
    expect(w.bilhetes()).toBe(0)
    expect(w.rodados.some((a) => ['mktemp', 'chmod', 'open', 'rm'].includes(a[0]!))).toBe(false)
    expect(w.escritos).toEqual([])
    expect(w.saidas.join('\n')).toContain(`quem responde na porta ${PORTA} não é o seu Expediente`)
    expect(w.brutos.join('\n')).not.toContain(TOKEN)
  })

  for (const mktemp of ['/etc', '/tmp/../etc/expediente-abrir.abcd1234', '', 'erro']) {
    test(`pasta que o mktemp devolve fora da forma (${JSON.stringify(mktemp)}): nada é gravado nem aberto`, async ($, on) => {
      const w = mundo(on, { token: TOKEN, mktemp })
      await $.command.run(RUN)
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      await ui.press({ key: 'abrir-escritorio' })
      await ui.unmount()
      expect(w.escritos).toEqual([])
      expect(w.rodados.some((a) => a[0] === 'open' || a[0] === 'chmod' || a[0] === 'rm')).toBe(false)
      expect(w.saidas.join('\n')).toContain('npm run abrir')
    })
  }

  test('chmod que falha: não abre, apaga a pasta na hora e avisa', async ($, on) => {
    const w = mundo(on, { token: TOKEN, chmod: 1 })
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'abrir-escritorio' })
    await ui.unmount()
    expect(w.rodados.some((a) => a[0] === 'open')).toBe(false)
    expect(w.rodados.filter((a) => a[0] === 'rm')).toEqual([['rm', '-rf', PASTA]])
    expect(w.saidas.join('\n')).toContain('npm run abrir')
    semSegredo(JSON.stringify(w.rodados))
  })
})

describe('"Abrir o escritório" fora do terminal', () => {
  test('o app desktop só desenha Link para https: ou http://localhost, e o localhost pode ser outro programa em ::1: sem Link nem bilhete, só o passo', async ($, on) => {
    const w = mundo(on, { token: TOKEN })
    await $.command.run(RUN)
    for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
      const ui = await $.ui.mount({ ...PANE, surface })
      expect(await ui.find({ type: 'Link', text: /Abrir o escritório/ }), surface).toBeUndefined()
      expect(await ui.find({ type: 'Button', text: /Abrir o escritório/ }), surface).toBeUndefined()
      expect(await ui.find({ text: /npm run abrir/ }), surface).toBeDefined()
      await ui.unmount()
    }
    expect(w.bilhetes()).toBe(0)
    expect(w.escritos).toEqual([])
    expect(w.rodados.some((a) => ['mktemp', 'chmod', 'open', 'rm'].includes(a[0]!))).toBe(false)
    expect(w.brutos.join('\n')).not.toContain(TOKEN)
  })
})

describe('sem token utilizável', () => {
  for (const token of [undefined, 'curto', 'G'.repeat(64), TOKEN.toUpperCase()]) {
    test(`${token === undefined ? 'arquivo ausente' : `formato inválido (${token.length} caracteres)`}: sem botão e sem Link, com o passo para abrir autorizado, e nenhum bilhete pedido`, async ($, on) => {
      const w = mundo(on, { token })
      await $.command.run(RUN)
      for (const surface of ['terminal', 'desktop'] as const) {
        const ui = await $.ui.mount({ ...PANE, surface })
        expect(await ui.find({ type: 'Link', text: /Abrir o escritório/ })).toBeUndefined()
        expect(await ui.find({ type: 'Button', text: /Abrir o escritório/ })).toBeUndefined()
        expect(await ui.find({ text: /npm run abrir/ })).toBeDefined()
        await ui.unmount()
      }
      expect(w.bilhetes()).toBe(0)
    })
  }
})
