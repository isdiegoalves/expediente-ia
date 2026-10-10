// Testes da lista permitida do `open` e da validação dos ids do foco. Nada aqui executa comando.
import { describe, expect, test } from 'claude-code/testing'
import { abrirUrl, argvAbrir } from '../hooks/abrir'
import { argvAtivarPainelWezTerm, argvFocoZellij } from '../hooks/painel'

const UUID = '11111111-aaaa-4aaa-8aaa-111111111111'

describe('argvAbrir', () => {
  test('aceita só as quatro formas da lista permitida', async () => {
    for (const url of [
      'claude://code/continue?session=local_aaaa-1',
      'claude://code/needs-input?session=local_aaaa-1',
      'claude://code/needs-input',
      `claude://resume?session=${UUID}`,
    ]) {
      expect(argvAbrir(url)).toEqual(['open', url])
    }
  })

  test('recusa file:, javascript:, https:, outro esquema e claude:// com parâmetro a mais antes do open', async () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://example.com/',
      'http://localhost:4848/api/agentes/x/ir',
      'ssh://host',
      'claude://code/new?folder=/tmp',
      'claude://code/new?session=local_aaaa-1',
      'claude://code/continue?session=local_aaaa-1&extra=1',
      'claude://code/continue?extra=1&session=local_aaaa-1',
      'claude://code/continue?session=local_aaaa-1#x',
      'claude://code/continue?session=local_aaaa-1\n',
      'claude://code/continue?session=local_',
      'claude://code/continue?session=aaaa-1',
      'claude://code/continue?session=local_../../x',
      `claude://code/continue?session=local_${'a'.repeat(65)}`,
      'claude://code/continue',
      'claude://code/needs-input?',
      'claude://code/needs-input?source=desktop_action',
      'claude://code/needs-input/',
      'claude://code/needs-input\n',
      'claude://resume?session=nao-e-uuid',
      `claude://resume?session=${UUID}&x=1`,
      `claude://code/resume?session=${UUID}`,
      ' claude://code/continue?session=local_aaaa-1',
      '-a Calculator',
    ]) {
      expect(argvAbrir(url)).toBeUndefined()
    }
    expect(argvAbrir(undefined as unknown as string)).toBeUndefined()
  })
})

describe('argv de foco só com ids no formato', () => {
  test('zellij recusa painel e sessão fora do formato', async () => {
    expect(() => argvFocoZellij({ ZELLIJ_PANE_ID: '5; rm', ZELLIJ_SESSION_NAME: 'main' })).toThrow()
    expect(() => argvFocoZellij({ ZELLIJ_PANE_ID: '5', ZELLIJ_SESSION_NAME: '--help' })).toThrow()
    expect(() => argvFocoZellij({ ZELLIJ_PANE_ID: '5', ZELLIJ_SESSION_NAME: 'a b' })).toThrow()
    expect(argvFocoZellij({ ZELLIJ_PANE_ID: '5', ZELLIJ_SESSION_NAME: 'main' })[2]).toBe('main')
  })

  test('WezTerm recusa painel e socket fora do formato', async () => {
    expect(() => argvAtivarPainelWezTerm({ WEZTERM_PANE: 'x', WEZTERM_UNIX_SOCKET: '/a/gui-sock-1' })).toThrow()
    expect(() => argvAtivarPainelWezTerm({ WEZTERM_PANE: '0', WEZTERM_UNIX_SOCKET: '/a/outro' })).toThrow()
    expect(() => argvAtivarPainelWezTerm({ WEZTERM_PANE: '0', WEZTERM_UNIX_SOCKET: '/a/gui-sock-1 --x' })).toThrow()
  })
})

describe('abrirUrl', () => {
  const APP = 'claude://code/continue?session=local_aaaa-1'

  test('URL fora da lista não chega ao run, nem chamada direto, e avisa', async () => {
    const rodados: string[][] = []
    const avisos: string[] = []
    const urls = ['file:///etc/passwd', 'https://example.com/', 'http://localhost:4848/api/agentes/x/ir?abrir=1', `${APP}&prompt=x`, '--help', '']
    for (const url of urls) {
      await abrirUrl(async (argv) => void rodados.push(argv), (t) => void avisos.push(t), url)
    }
    expect(rodados).toEqual([])
    expect(avisos).toHaveLength(urls.length)
    expect(avisos[0]).toMatch(/fora da lista permitida/)
  })

  test('URL da lista roda exatamente o argv da lista; falha do run vira aviso, sem lançar', async () => {
    const rodados: string[][] = []
    const avisos: string[] = []
    await abrirUrl(async (argv) => void rodados.push(argv), (t) => void avisos.push(t), APP)
    expect(rodados).toEqual([['open', APP]])
    expect(avisos).toEqual([])
    const falha = async () => {
      throw new Error('sem processo')
    }
    await abrirUrl(falha, (t) => void avisos.push(t), APP)
    expect(avisos).toEqual(['Expediente: não deu para abrir o app'])
  })
})
