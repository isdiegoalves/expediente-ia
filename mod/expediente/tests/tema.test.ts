// `/escritorio tema padrao`: grava "padrao" em ~/.expediente/host/tema-ativo sem o modelo e sem falar com o Expediente.
// Rodado por `claude plugin test` dentro de mod/expediente; o sistema de arquivos é um mapa em memória.
import type { CommandRunInput, On } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import { ehTemaPadrao, temaAtivoOf } from '../hooks/tema'

const NOW = Date.parse('2026-10-12T12:00:00Z')
const HOME = '/home/fulano'
const ATIVO = `${HOME}/.expediente/host/tema-ativo`
const run = (args: string): CommandRunInput => ({ command: 'escritorio', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } })

interface Mundo {
  /** O que `$.fs.stat` acha por caminho (o que falta não existe). */
  stats?: Record<string, { kind: 'file' | 'dir' | 'other'; isLink: boolean }>
  home?: boolean
  gravaFalha?: boolean
}

function mundo(on: On, w: Mundo = {}) {
  mock.clock(on, { now: NOW })
  mock.env(on, w.home === false ? {} : { HOME })
  const escritas: Array<{ path: string; text: string }> = []
  const urls: string[] = []
  let modelo = 0
  on('model.complete', () => {
    modelo++
    return { deny: 'sem modelo' }
  })
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000, tokens: 1, percent: 0 }, rateLimits: [] } }))
  on('ui.open', () => ({ value: undefined }))
  on('http.fetch', ($, e) => {
    urls.push(e.url)
    return { deny: 'ECONNREFUSED' }
  })
  on('fs.stat', ($, e) => {
    const s = w.stats?.[e.path]
    return s ? { value: { ...s, size: 1, mtimeMs: NOW } } : { deny: 'ENOENT' }
  })
  on('fs.write', ($, e) => {
    if (w.gravaFalha) return { deny: 'EACCES: permissão negada' }
    escritas.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  return { escritas, urls, modelo: () => modelo }
}

const REGULAR = { kind: 'file', isLink: false } as const
const LINK = { kind: 'file', isLink: true } as const

describe('/escritorio tema padrao', () => {
  test('grava "padrao" em tema-ativo, responde sem o modelo e sem falar com o Expediente', async ($, on) => {
    const m = mundo(on, { stats: { [ATIVO]: REGULAR } })
    const out = await $.command.run(run('tema padrao'))
    expect(m.escritas).toEqual([{ path: ATIVO, text: 'padrao\n' }])
    expect(out.text).toMatch(/^Tema padrão restaurado/)
    expect(m.modelo()).toBe(0)
    expect(m.urls).toEqual([])
  })

  test('sem tema-ativo ainda (e sem a pasta), grava do mesmo jeito', async ($, on) => {
    const m = mundo(on)
    await $.command.run(run('tema padrao'))
    expect(m.escritas).toEqual([{ path: ATIVO, text: 'padrao\n' }])
  })

  test('com acento, caixa alta e espaços sobrando também vale', async ($, on) => {
    const m = mundo(on)
    await $.command.run(run('  Tema   PADRÃO '))
    expect(m.escritas).toHaveLength(1)
  })

  test('outros argumentos não gravam nada', async ($, on) => {
    const m = mundo(on)
    for (const args of ['tema', 'tema outro', 'tema padrao agora', 'padrao', 'tema padrao; rm -rf ~']) await $.command.run(run(args))
    expect(m.escritas).toEqual([])
  })

  const recusa = (nome: string, stats: NonNullable<Mundo['stats']>) =>
    test(`${nome}: recusa e não grava`, async ($, on) => {
      const m = mundo(on, { stats })
      const out = await $.command.run(run('tema padrao'))
      expect(m.escritas).toEqual([])
      expect(out.text).toMatch(/Nada foi gravado/)
    })
  recusa('tema-ativo que é link simbólico', { [ATIVO]: LINK })
  recusa('tema-ativo que é pasta', { [ATIVO]: { kind: 'dir', isLink: false } })
  recusa('.expediente/host que é link simbólico', { [`${HOME}/.expediente/host`]: { kind: 'dir', isLink: true } })
  recusa('.expediente que é link simbólico', { [`${HOME}/.expediente`]: { kind: 'dir', isLink: true } })

  test('falha ao gravar: diz que nada mudou, sem lançar', async ($, on) => {
    mundo(on, { gravaFalha: true })
    const out = await $.command.run(run('tema padrao'))
    expect(out.text).toMatch(/Não consegui gravar .*tema-ativo/)
  })

  test('sem HOME não sabe onde gravar e não grava', async ($, on) => {
    const m = mundo(on, { home: false })
    const out = await $.command.run(run('tema padrao'))
    expect(m.escritas).toEqual([])
    expect(out.text).toMatch(/HOME/)
  })
})

describe('funções puras do tema', () => {
  test('caminho do tema-ativo e o subcomando reconhecido', () => {
    expect(temaAtivoOf('/home/f')).toBe('/home/f/.expediente/host/tema-ativo')
    expect(ehTemaPadrao('tema padrao')).toBe(true)
    expect(ehTemaPadrao('Tema Padrão')).toBe(true)
    expect(ehTemaPadrao('tema padraox')).toBe(false)
    expect(ehTemaPadrao('resumo')).toBe(false)
    expect(ehTemaPadrao('')).toBe(false)
  })
})
