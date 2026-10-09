// Foco do painel do terminal da sessão viva (zellij dentro do WezTerm). Aqui só se monta argv e se lê texto; quem
// executa é o mod, com a permissão do dono. Este é o único arquivo que lê o ambiente de outro processo.

export interface PainelZellij {
  ZELLIJ_PANE_ID: string
  ZELLIJ_SESSION_NAME: string
}

export interface ClienteWezTerm {
  WEZTERM_PANE: string
  WEZTERM_UNIX_SOCKET: string
}

function pidValido(pid: number): string {
  if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) throw new Error('pid inválido')
  return String(pid)
}

/** O filtro roda dentro do `sh`: o ambiente bruto do outro processo não sai dele. O pid vai como `$1`. */
const LEITOR_ZELLIJ = 'ps eww -o command= -p "$1" | tr " " "\\n" | grep -E "^ZELLIJ_(PANE_ID|SESSION_NAME)="'
const LEITOR_WEZTERM = 'ps eww -o command= -p "$1" | tr " " "\\n" | grep -E "^WEZTERM_(PANE|UNIX_SOCKET)="'

export function argvLeitorPainel(pid: number): string[] {
  return ['/bin/sh', '-c', LEITOR_ZELLIJ, 'leitor', pidValido(pid)]
}

/** Para o cliente `zellij attach` vivo, nunca para o processo `claude`: o valor deste vem de um WezTerm morto. */
export function argvLeitorClienteWezTerm(pid: number): string[] {
  return ['/bin/sh', '-c', LEITOR_WEZTERM, 'leitor', pidValido(pid)]
}

const PANE_ID = /^\d{1,6}$/
const SESSAO = /^[A-Za-z0-9._-]{1,64}$/
const SOCKET = /^\/[A-Za-z0-9._\-/]{1,200}\/gui-sock-\d{1,10}$/

function pares(texto: string): Map<string, string> {
  const mapa = new Map<string, string>()
  for (const linha of texto.split('\n')) {
    const i = linha.indexOf('=')
    if (i > 0 && !mapa.has(linha.slice(0, i))) mapa.set(linha.slice(0, i), linha.slice(i + 1).trim())
  }
  return mapa
}

export function lerPainel(texto: string): PainelZellij | undefined {
  const m = pares(texto)
  const pane = m.get('ZELLIJ_PANE_ID')
  const sessao = m.get('ZELLIJ_SESSION_NAME')
  if (pane === undefined || sessao === undefined || !PANE_ID.test(pane) || !SESSAO.test(sessao)) return undefined
  return { ZELLIJ_PANE_ID: pane, ZELLIJ_SESSION_NAME: sessao }
}

export function lerClienteWezTerm(texto: string): ClienteWezTerm | undefined {
  const m = pares(texto)
  const pane = m.get('WEZTERM_PANE')
  const socket = m.get('WEZTERM_UNIX_SOCKET')
  if (pane === undefined || socket === undefined || !PANE_ID.test(pane) || !SOCKET.test(socket)) return undefined
  return { WEZTERM_PANE: pane, WEZTERM_UNIX_SOCKET: socket }
}

export function argvFocoZellij(p: PainelZellij): string[] {
  return ['zellij', '--session', p.ZELLIJ_SESSION_NAME, 'action', 'focus-pane-id', `terminal_${p.ZELLIJ_PANE_ID}`]
}

export function argvTrazerWezTerm(): string[] {
  return ['open', '-a', 'WezTerm']
}

export function argvAtivarPainelWezTerm(c: ClienteWezTerm): string[] {
  return ['env', `WEZTERM_UNIX_SOCKET=${c.WEZTERM_UNIX_SOCKET}`, 'wezterm', 'cli', 'activate-pane', '--pane-id', c.WEZTERM_PANE]
}

/** Os três comandos do foco, na ordem em que devem rodar. */
export function planoFocoZellij(p: PainelZellij, c: ClienteWezTerm): string[][] {
  return [argvFocoZellij(p), argvTrazerWezTerm(), argvAtivarPainelWezTerm(c)]
}

const TTY = /^\/dev\/ttys\d{1,4}$/

const SCRIPT_TERMINAL = `on run argv
  set alvo to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is alvo then
          set selected of t to true
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "nao"
end run`

const SCRIPT_ITERM2 = `on run argv
  set alvo to item 1 of argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          if tty of s is alvo then
            select s
            select t
            activate
            return "ok"
          end if
        end repeat
      end repeat
    end repeat
  end tell
  return "nao"
end run`

/** Ramo genérico, sem zellij: o tty vai como argumento do script, nunca dentro do texto. Não testado ao vivo. */
export function argvFocoTerminalApp(app: 'Terminal' | 'iTerm2', tty: string): string[] {
  if (app !== 'Terminal' && app !== 'iTerm2') throw new Error('app não suportado')
  if (!TTY.test(tty)) throw new Error('tty inválido')
  return ['osascript', '-e', app === 'Terminal' ? SCRIPT_TERMINAL : SCRIPT_ITERM2, tty]
}
