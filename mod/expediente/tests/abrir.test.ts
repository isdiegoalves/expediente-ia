// Testes da lista permitida do `open` e da validação dos ids do foco. Nada aqui executa comando.
import { describe, expect, test } from 'claude-code/testing'
import { abrirUrl, argvAbrir, argvChmod, argvLimpar, argvMktemp, arquivoDoEscritorio, ehUrlDoEscritorio, htmlDoEscritorio, pastaTemporaria } from '../hooks/abrir'
import { argvAtivarPainelWezTerm, argvFocoZellij } from '../hooks/painel'

const UUID = '11111111-aaaa-4aaa-8aaa-111111111111'

describe('argvAbrir', () => {
  test('aceita só as três formas da lista permitida', async () => {
    for (const url of [
      'claude://code/continue?session=local_aaaa-1',
      'claude://code/needs-input?session=local_aaaa-1',
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
      'claude://code/needs-input',
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

const BILHETE = '00112233445566778899aabbccddeeff'
const PASTA = '/var/folders/ab/cdef_gh/T/expediente-abrir.XXXXXXXX.aBcD1234'

describe('o escritório com o bilhete de uso único', () => {
  test('a URL é só http://127.0.0.1:<porta>/#b=<32 hexadecimais minúsculos>', async () => {
    for (const porta of ['4848', '80', '65535']) expect(ehUrlDoEscritorio(`http://127.0.0.1:${porta}/#b=${BILHETE}`)).toBe(true)
    for (const url of [
      `http://localhost:4848/#b=${BILHETE}`,
      `http://[::1]:4848/#b=${BILHETE}`,
      `http://127.0.0.2:4848/#b=${BILHETE}`,
      `http://expediente.localhost:4848/#b=${BILHETE}`,
      `https://127.0.0.1:4848/#b=${BILHETE}`,
      `http://127.0.0.1/#b=${BILHETE}`,
      `http://127.0.0.1:0/#b=${BILHETE}`,
      `http://127.0.0.1:65536/#b=${BILHETE}`,
      `http://127.0.0.1:99999/#b=${BILHETE}`,
      `http://127.0.0.1:4848@evil.example/#b=${BILHETE}`,
      `http://evil.example@127.0.0.1:4848/#b=${BILHETE}`,
      `http://127.0.0.1:4848#b=${BILHETE}`,
      `http://127.0.0.1:4848/x#b=${BILHETE}`,
      `http://127.0.0.1:4848/?a=1#b=${BILHETE}`,
      `http://127.0.0.1:4848/#t=${'a'.repeat(64)}`,
      `http://127.0.0.1:4848/#t=${BILHETE}`,
      `http://127.0.0.1:4848/#b=${BILHETE.slice(1)}`,
      `http://127.0.0.1:4848/#b=${BILHETE}0`,
      `http://127.0.0.1:4848/#b=${BILHETE.toUpperCase()}`,
      `http://127.0.0.1:4848/#b=${BILHETE}&x=1`,
      `http://127.0.0.1:4848/#b=${BILHETE}\n`,
      ` http://127.0.0.1:4848/#b=${BILHETE}`,
      'http://127.0.0.1:4848/',
      'http://127.0.0.1:4848/#b=',
    ]) {
      expect(ehUrlDoEscritorio(url), url).toBe(false)
    }
    expect(ehUrlDoEscritorio(undefined as unknown as string)).toBe(false)
  })

  test('a URL do escritório, com o bilhete, nunca chega a um argv: nem pelo argvAbrir', async () => {
    expect(argvAbrir(`http://127.0.0.1:4848/#b=${BILHETE}`)).toBeUndefined()
    expect(argvAbrir(`http://localhost:4848/#b=${BILHETE}`)).toBeUndefined()
    const rodados: string[][] = []
    const avisos: string[] = []
    await abrirUrl(async (argv) => void rodados.push(argv), (t) => void avisos.push(t), `http://127.0.0.1:4848/#b=${BILHETE}`)
    expect(rodados).toEqual([])
    expect(avisos).toHaveLength(1)
  })

  test('o HTML de redirecionamento só sai para a URL da forma estrita, com ela e nada mais de variável', async () => {
    const url = `http://127.0.0.1:4848/#b=${BILHETE}`
    const html = htmlDoEscritorio(url)!
    expect(html).toContain(`<meta http-equiv="refresh" content="0;url=${url}">`)
    expect(html.split(url)).toHaveLength(3)
    expect(htmlDoEscritorio(`${url}"><script>x</script>`)).toBeUndefined()
    expect(htmlDoEscritorio('http://127.0.0.1:4848/')).toBeUndefined()
  })

  test('a pasta temporária é a que o mktemp -d devolve: caminho absoluto, nome expediente-abrir.*, sem . nem .. e sem texto de shell', async () => {
    expect(pastaTemporaria(`${PASTA}\n`)).toBe(PASTA)
    expect(pastaTemporaria('/tmp/expediente-abrir.abcd1234')).toBe('/tmp/expediente-abrir.abcd1234')
    for (const pasta of [
      '',
      'expediente-abrir.abcd1234',
      '/expediente-abrir.abcd1234',
      '/tmp/outra.abcd1234',
      '/tmp/expediente-abrir.',
      '/tmp/expediente-abrir.abc',
      '/tmp/../etc/expediente-abrir.abcd1234',
      '/tmp/./expediente-abrir.abcd1234',
      '/tmp/expediente-abrir.abcd1234/..',
      '/tmp/expediente-abrir.abcd1234/outra',
      '/tmp/expediente-abrir.abcd 1234',
      '/tmp/expediente-abrir.abcd1234; rm -rf /',
      '/tmp/$(id)/expediente-abrir.abcd1234',
      '/tmp/`id`/expediente-abrir.abcd1234',
      '/tmp/a b/expediente-abrir.abcd1234',
      '-rf /tmp/expediente-abrir.abcd1234',
      '/tmp/expediente-abrir.abcd1234\n/etc',
    ]) {
      expect(pastaTemporaria(pasta), pasta).toBeUndefined()
    }
  })

  test('o open recebe só o abrir.html de uma pasta dessas; chmod e rm -rf, só o arquivo e a pasta', async () => {
    const arquivo = arquivoDoEscritorio(PASTA)
    expect(argvAbrir(arquivo)).toEqual(['open', arquivo])
    expect(argvChmod(arquivo)).toEqual(['chmod', '600', arquivo])
    expect(argvLimpar(PASTA)).toEqual(['rm', '-rf', PASTA])
    for (const alvo of [`${PASTA}/outro.html`, `${PASTA}/abrir.htm`, `${PASTA}/../abrir.html`, '/etc/passwd', '/tmp/abrir.html', `${PASTA}/sub/abrir.html`, `${arquivo}\n`, `${arquivo} -a Calculator`, `-a ${arquivo}`]) {
      expect(argvAbrir(alvo), alvo).toBeUndefined()
      expect(argvChmod(alvo), alvo).toBeUndefined()
    }
    for (const pasta of ['/', '/tmp', '/Users/fulano', `${PASTA}/..`, `${PASTA}/`, '', `${PASTA} /etc`, '/tmp/expediente-abrir.abcd1234/abrir.html']) {
      expect(argvLimpar(pasta), pasta).toBeUndefined()
    }
    expect(argvMktemp).toEqual(['mktemp', '-d', '-t', 'expediente-abrir.XXXXXXXX'])
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
