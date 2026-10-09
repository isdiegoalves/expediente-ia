// Testes do leitor de painel e da montagem do argv de foco. Nada aqui executa comando: o foco muda a tela do dono.
import { describe, expect, test } from 'claude-code/testing'
import {
  argvAppRodando,
  argvAtivarPainelWezTerm,
  argvFocoTerminalApp,
  argvFocoZellij,
  argvLeitorClienteWezTerm,
  argvLeitorPainel,
  argvTrazerWezTerm,
  argvTtyDe,
  lerClienteWezTerm,
  lerPainel,
  lerTty,
  planoFocoZellij,
} from '../hooks/painel'

describe('ramo genérico', () => {
  test('o tty sai do ps só com o pid inteiro, e só ttysNNN vira caminho', () => {
    expect(argvTtyDe(507)).toEqual(['ps', '-o', 'tty=', '-p', '507'])
    expect(() => argvTtyDe(0)).toThrow()
    expect(lerTty('ttys003\n')).toBe('/dev/ttys003')
    for (const ruim of ['??', '', 'ttys3; rm', '../ttys003', 'console']) expect(lerTty(ruim)).toBeUndefined()
  })

  test('pgrep -x só para os dois apps conhecidos', () => {
    expect(argvAppRodando('iTerm2')).toEqual(['pgrep', '-x', 'iTerm2'])
    expect(() => argvAppRodando('WezTerm' as 'Terminal')).toThrow()
  })
})

const SOCKET = '/Users/fulano/.local/share/wezterm/gui-sock-70237'

describe('argvLeitorPainel', () => {
  test('o mod só roda o leitor com pid inteiro', async () => {
    for (const ruim of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(() => argvLeitorPainel(ruim)).toThrow()
      expect(() => argvLeitorClienteWezTerm(ruim)).toThrow()
    }
    expect(() => argvLeitorPainel('12; rm -rf /' as unknown as number)).toThrow()
  })

  test('o pid entra como $1 e nunca no texto do script', async () => {
    const argv = argvLeitorPainel(4321)
    expect(argv.slice(0, 2)).toEqual(['/bin/sh', '-c'])
    expect(argv[2]).toContain('ps eww -o command= -p "$1"')
    expect(argv[2]).toContain('grep -E "^ZELLIJ_(PANE_ID|SESSION_NAME)="')
    expect(argv[2]).not.toContain('4321')
    expect(argv.slice(3)).toEqual(['leitor', '4321'])
  })

  test('o leitor do cliente filtra só as duas variáveis do WezTerm', async () => {
    expect(argvLeitorClienteWezTerm(99)[2]).toContain('grep -E "^WEZTERM_(PANE|UNIX_SOCKET)="')
  })
})

describe('lerPainel e lerClienteWezTerm', () => {
  test('aceitam só as chaves e os formatos esperados', async () => {
    expect(lerPainel('ZELLIJ_PANE_ID=5\nZELLIJ_SESSION_NAME=main\n')).toEqual({ ZELLIJ_PANE_ID: '5', ZELLIJ_SESSION_NAME: 'main' })
    expect(lerPainel('ZELLIJ_PANE_ID=5\n')).toBeUndefined()
    expect(lerPainel('NEXUS_PASSWORD=x\nZELLIJ_PANE_ID=5\nZELLIJ_SESSION_NAME=main\n')).toEqual({ ZELLIJ_PANE_ID: '5', ZELLIJ_SESSION_NAME: 'main' })
    expect(lerClienteWezTerm(`WEZTERM_PANE=0\nWEZTERM_UNIX_SOCKET=${SOCKET}\n`)).toEqual({ WEZTERM_PANE: '0', WEZTERM_UNIX_SOCKET: SOCKET })
    expect(lerClienteWezTerm('WEZTERM_PANE=0\nWEZTERM_UNIX_SOCKET=/tmp/outro\n')).toBeUndefined()
  })
})

describe('argv de foco', () => {
  test('zellij: sessão e painel viram argumentos separados, sem shell', async () => {
    expect(argvFocoZellij({ ZELLIJ_PANE_ID: '5', ZELLIJ_SESSION_NAME: 'main' })).toEqual([
      'zellij', '--session', 'main', 'action', 'focus-pane-id', 'terminal_5',
    ])
  })

  test('WezTerm: traz o app e ativa o painel do cliente com o socket dele', async () => {
    expect(argvTrazerWezTerm()).toEqual(['open', '-a', 'WezTerm'])
    expect(argvAtivarPainelWezTerm({ WEZTERM_PANE: '0', WEZTERM_UNIX_SOCKET: SOCKET })).toEqual([
      'env', `WEZTERM_UNIX_SOCKET=${SOCKET}`, 'wezterm', 'cli', 'activate-pane', '--pane-id', '0',
    ])
  })

  test('plano: zellij, depois o app, depois o painel do cliente', async () => {
    const plano = planoFocoZellij(
      { ZELLIJ_PANE_ID: '5', ZELLIJ_SESSION_NAME: 'main' },
      { WEZTERM_PANE: '0', WEZTERM_UNIX_SOCKET: SOCKET },
    )
    expect(plano.map((a) => a[0])).toEqual(['zellij', 'open', 'env'])
  })

  test('Terminal e iTerm2: o tty vai como argumento do osascript, fora do texto do script', async () => {
    const t = argvFocoTerminalApp('Terminal', '/dev/ttys004')
    expect(t[0]).toBe('osascript')
    expect(t[t.length - 1]).toBe('/dev/ttys004')
    expect(t.slice(0, -1).join(' ')).not.toContain('ttys004')
    expect(argvFocoTerminalApp('iTerm2', '/dev/ttys004').join(' ')).toContain('iTerm2')
    expect(() => argvFocoTerminalApp('Terminal', '/dev/ttys004"; do shell script "x')).toThrow()
    expect(() => argvFocoTerminalApp('Kitty' as unknown as 'Terminal', '/dev/ttys004')).toThrow()
  })
})
