// O link "Abrir o escritório" do painel do /escritorio: leva o token no fragmento da URL, e só ali.
import type { CommandRunInput, HttpResponse, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const PORTA = '4853'
const TOKEN = '5e17e11a'.repeat(8)
const ESCRITORIO = `http://localhost:${PORTA}/#t=${TOKEN}`
const RUN: CommandRunInput = { command: 'escritorio', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }
const PANE = {
  plugin: 'expediente',
  component: 'Pane',
  requestId: 'escritorio',
  props: { title: 'Escritório', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const
const RODOU = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

function resposta(texto: string): HttpResponse {
  return { status: 200, ok: true, headers: { 'content-type': 'application/json' }, text: texto }
}

function mundo(on: On, token: string | undefined) {
  mock.clock(on, { now: NOW })
  mock.env(on, { HOME: '/home/fulano', CLAUDE_CONFIG_DIR: '~/.claude', EXPEDIENTE_PORT: PORTA })
  const rodados: string[][] = []
  const saidas: string[] = []
  on('session.id', () => ({ value: 'sess-propria' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', (_$, e) => {
    saidas.push(e.text)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => (token !== undefined && e.path === '/home/fulano/.expediente/host/token' ? { value: `${token}\n` } : { deny: 'ENOENT' }))
  on('process.run', (_$, e) => {
    rodados.push([...e.argv])
    return { value: RODOU }
  })
  on('http.fetch', (_$, e) => {
    if (e.url.includes('/api/mod/focos')) return { value: resposta('{"focos":[]}') }
    const usage = [{ id: '.claude:11', name: 'Ana', kind: 'main', status: 'idle', room: 'loja', compactions: 0 }]
    return { value: resposta(JSON.stringify({ version: '1', agents: 1, working: 0, waiting: [], usage })) }
  })
  return { rodados, saidas }
}

describe('link "Abrir o escritório"', () => {
  test('no terminal: Link e botão com a URL que leva o token; o botão roda open só com ela', async ($, on) => {
    const w = mundo(on, TOKEN)
    const texto = (await $.command.run(RUN)) as { text?: string }
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    expect((await ui.find({ type: 'Link', text: /Abrir o escritório/ }))?.props.href).toBe(ESCRITORIO)
    await ui.press({ key: 'abrir-escritorio' })
    expect(w.rodados.filter((a) => a[0] === 'open')).toEqual([['open', ESCRITORIO]])
    expect(await ui.findAll({ text: new RegExp(TOKEN) })).toEqual([])
    await ui.unmount()
    expect(texto.text ?? '').not.toContain(TOKEN)
    expect(w.saidas.join('\n')).not.toContain(TOKEN)
  })

  test('no app desktop: só o Link, sem botão e sem rodar nada', async ($, on) => {
    const w = mundo(on, TOKEN)
    await $.command.run(RUN)
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    expect((await ui.find({ type: 'Link', text: /Abrir o escritório/ }))?.props.href).toBe(ESCRITORIO)
    expect(await ui.find({ type: 'Button', text: /^Abrir$/ })).toBeUndefined()
    await ui.unmount()
    expect(w.rodados).toEqual([])
  })

  for (const token of [undefined, 'curto', 'G'.repeat(64)]) {
    test(`sem token utilizável (${token === undefined ? 'arquivo ausente' : 'formato inválido'}): sem link, com o passo para abrir autorizado`, async ($, on) => {
      mundo(on, token)
      await $.command.run(RUN)
      const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
      expect(await ui.find({ type: 'Link', text: /Abrir o escritório/ })).toBeUndefined()
      expect(await ui.find({ text: /npm run abrir/ })).toBeDefined()
      await ui.unmount()
    })
  }
})
