// Mod do Expediente (Claude Code 2.1.287+): liga cada sessão ao escritório sem ler a conversa.
//
// Faz seis coisas pequenas, e `claude plugin validate` lista exatamente o que o módulo chama (a saída
// está no mod/README.md):
//
// 1. Uso do plano (substitui o tap de statusline): em `session.start` e a cada `session.measure`
//    (depois de cada turno e quando um limite anda um ponto inteiro) grava
//    <EXPEDIENTE_USAGE_DIR ou ~/.expediente/host/uso>/<conta>.json no MESMO formato do scripts/statusline-tap.mjs
//    ({accountId, configDir, fetchedAt, five_hour, seven_day}, `resets_at` em segundos) mais
//    `source: "mod"`. O servidor lê esses arquivos em server/accounts/statusline.ts.
// 2. Uma linha embaixo do prompt quando OUTRA sessão precisa de você: a cada 4 s pergunta ao Expediente
//    local (GET /api/mod/summary, que já tira da lista esta sessão e os subagentes dela). Fora do ar, a
//    linha some e as perguntas passam a ser a cada 30 s até ele voltar. Só onde a sessão desenha
//    (`$.session.surfaces()` vazia = `claude -p`/SDK: nada a mostrar, nada a perguntar).
// 3. /escritorio: sessões por estado com contexto e custo, respondidas pelo próprio mod (não chama o modelo, não
//    gasta uso), e um painel com o caminho de cada sessão (link do app, foco do painel do terminal ou o comando seguro).
// 4. Ponte do app desktop (ponte.ts): a cada 5 s copia 3 campos por sessão do app para
//    ~/.expediente/host/sessoes-app.json, que o servidor no container lê.
// 5. Amostra horária (amostra.ts): contagem por entrypoint × kind e nomes de programa da cadeia de pais das sessões vivas.
//
// 6. Foco pedido pelo navegador (foco.ts): a cada 1 s, só onde há terminal e com o Expediente no ar, busca os pedidos
//    de foco (GET /api/mod/focos), assume um (POST .../assumir) e roda o mesmo plano do botão Focar, com o pid inteiro
//    que o servidor devolve e a conferência de que ele ainda é o claude. Reporta o resultado (POST .../resultado).
//
// Regras: nenhum hook lança (um hook que lança é pulado, mas o que ele deixou pela metade fica): cada
// passo tem seu try/catch e falha = silêncio. $.process roda só argv fixo, sem shell montado de texto alheio: mv e rm -f do .tmp (ponte),
// pgrep e o próprio ps (amostra, tty, confirmação do programa do pid), o leitor de ZELLIJ_*/WEZTERM_* (foco), zellij, open -a WezTerm, osascript
// (foco) e open com URL da lista permitida (abrir o app); nada de
// $.model, $.prompt, decisão de ferramenta nem leitura da conversa; a rede é só 127.0.0.1. O estado fica em variáveis do módulo: um
// hot reload recomeça do zero, o que aqui custa no máximo uma regravação a mais do arquivo de uso.
//
// Análise estática do Claude Code: cada chamada é escrita por extenso ($.noun.método), o nome do evento é
// sempre uma string literal e `$` só é passado para funções declaradas no topo deste arquivo.
import type { EngineInterface, HttpResponse, Register, RenderSurface, SessionRateLimit } from 'claude-code'
import { abrirUrl } from './abrir'
import { FOCO_OFFLINE_MS, FOCO_POLL_MS, lerPedidos, lerPidAssumido, type ResultadoFoco } from './foco'
import { acoesDaSessao, detalheTexto, lerIr, listaTexto, nomeDaLinha, pidDoId, porEstado, type IrView } from './escritorio'
import { offlineText, outdatedText, parseSummary, statusText, summaryText, type Summary } from './resumo'
import { argvAppRodando, argvFocoTerminalApp, argvFocoZellij, argvLeitorPainel, argvProgramaDe, argvTrazerWezTerm, argvTtyDe, ehClaude, lerPainel, lerTty, type PainelZellij } from './painel'
import { AMOSTRA_MS, argvPaiDe, arquivoAmostraOf, contarMix, contarProgramas, ehAmostraDaConta, horaDe, lerEntradaRegistro, marcadorAmostraOf, MAX_AMOSTRAS, MAX_NIVEIS, MAX_PIDS, paiDe, pastaAmostrasOf, type EntradaRegistro } from './amostra'
import { appDirOf, filtrarSessaoApp, FRESCO_MS, PONTE_MS, sessoesAppFileOf, type SessaoApp } from './ponte'

export { offlineText, outdatedText, parseSummary, statusText, summaryText, type Summary, type WaitingAgent } from './resumo'

/** Porta padrão do Expediente (a mesma do servidor, do hook de permissão e do docker-compose). */
export const DEFAULT_PORT = 4848
/** Intervalo das perguntas ao Expediente; fora do ar, recua para o segundo até ele voltar. */
export const POLL_MS = 4_000
export const OFFLINE_POLL_MS = 30_000
/** Quanto esperar o Expediente local responder (`$.http.fetch` não aceita AbortSignal: a corrida é com um timer). */
export const FETCH_TIMEOUT_MS = 2_000
/** Valores idênticos gravados há menos que isto não são regravados (a mesma regra do tap). */
export const MIN_REWRITE_MS = 10_000
/** Uma janela no formato do tap: percentual 0–100 e reinício em SEGUNDOS desde a época. */
export interface UsageWindow {
  utilization: number
  resets_at?: number
}

/** O arquivo de uso: o formato do tap mais `source`, para saber quem gravou. */
export interface UsageRecord {
  accountId: string
  configDir: string
  fetchedAt: number
  five_hour?: UsageWindow
  seven_day?: UsageWindow
  source: 'mod'
}

/** Resultado de uma pergunta ao Expediente: resposta, fora do ar ou uma versão antiga, sem a rota do mod. */
type Asked = { kind: 'ok'; summary: Summary } | { kind: 'offline' } | { kind: 'outdated' }

interface ModEnv {
  /** Config dir da conta e o id dela (basename), como o tap calcula; sem HOME nem CLAUDE_CONFIG_DIR, ausentes. */
  configDir?: string
  accountId?: string
  /** Pasta do uso; ausente sem HOME nem EXPEDIENTE_USAGE_DIR. */
  usageDir?: string
  port: number
}

// ---------------------------------------------------------------------------------------------
// Funções puras (testadas em tests/expediente.test.ts)
// ---------------------------------------------------------------------------------------------

/** Normaliza um caminho (barras repetidas, `.`, `..` e a barra do fim): o ambiente do mod não tem node:path. */
export function normalizePath(p: string): string {
  const abs = p.startsWith('/')
  const out: string[] = []
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue
    if (seg === '..') {
      if (out.length && out[out.length - 1] !== '..') out.pop()
      else if (!abs) out.push(seg)
      continue
    }
    out.push(seg)
  }
  const joined = out.join('/')
  return abs ? `/${joined}` : joined || '.'
}

/** `~` no começo vira o HOME (como o tap faz com CLAUDE_CONFIG_DIR e EXPEDIENTE_USAGE_DIR). */
function expandHome(p: string, home: string | undefined): string {
  return home && /^~(?=\/|$)/.test(p) ? home + p.slice(1) : p
}

/** Config dir da conta: o primeiro item de CLAUDE_CONFIG_DIR (com `~` expandido) ou ~/.claude. */
export function configDirOf(claudeConfigDir: string | undefined, home: string | undefined): string | undefined {
  const first = (claudeConfigDir ?? '').split(',')[0]?.trim() ?? ''
  if (first) return normalizePath(expandHome(first, home))
  return home ? normalizePath(`${home}/.claude`) : undefined
}

/** Id da conta = nome da pasta (AccountInfo.id do servidor, ex.: ".claude-conta2"). */
export function accountIdOf(configDir: string): string | undefined {
  const name = configDir.split('/').filter(Boolean).pop()
  return name && name !== '.' && name !== '..' ? name : undefined
}

export function usageDirOf(expedienteUsageDir: string | undefined, home: string | undefined): string | undefined {
  const d = (expedienteUsageDir ?? '').trim()
  if (d) return normalizePath(expandHome(d, home))
  return home ? normalizePath(`${home}/.expediente/host/uso`) : undefined
}

export function portOf(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isInteger(n) && n > 0 && n < 65_536 ? n : DEFAULT_PORT
}

/**
 * Uma janela de `$.session.usage().rateLimits` no formato do tap. `percentUsed` vem de 0 a 100 (passa de
 * 100 só num spend limit estourado, que não gravamos); `resetsAt` vem em ISO 8601 e o tap grava SEGUNDOS.
 */
export function windowOf(rl: SessionRateLimit | undefined): UsageWindow | undefined {
  if (!rl || typeof rl.percentUsed !== 'number' || !Number.isFinite(rl.percentUsed)) return undefined
  const w: UsageWindow = { utilization: Math.min(100, Math.max(0, rl.percentUsed)) }
  const ms = typeof rl.resetsAt === 'string' ? Date.parse(rl.resetsAt) : Number.NaN
  if (Number.isFinite(ms)) w.resets_at = Math.round(ms / 1_000)
  return w
}

/**
 * O registro gravado, ou undefined sem janela utilizável (fora de uma assinatura, ou antes da primeira
 * resposta da API, `rateLimits` vem vazia). Só `five_hour` e `seven_day`: o `spend_limit` de um gateway
 * não é limite do plano.
 */
export function usageRecord(rateLimits: readonly SessionRateLimit[], configDir: string, now: number): UsageRecord | undefined {
  const accountId = accountIdOf(configDir)
  if (!accountId) return undefined
  const five = windowOf(rateLimits.find((r) => r.kind === 'five_hour'))
  const week = windowOf(rateLimits.find((r) => r.kind === 'seven_day'))
  if (!five && !week) return undefined
  const rec: UsageRecord = { accountId, configDir, fetchedAt: now, source: 'mod' }
  if (five) rec.five_hour = five
  if (week) rec.seven_day = week
  return rec
}

// ---------------------------------------------------------------------------------------------
// Estado do módulo (some num hot reload) e o que fala com o Claude Code
// ---------------------------------------------------------------------------------------------

let env: ModEnv | undefined
/** Última gravação do arquivo de uso (chave = arquivo + valores), para não regravar o mesmo em menos de 10 s. */
let lastWrite: { key: string; at: number } | undefined
/** Texto da linha de status; null = ainda não mexemos nela nesta carga (a primeira chamada sempre passa). */
let lastStatus: string | undefined | null = null
let timer: { cancel: () => void } | undefined
let timerMs = 0
let ponteTimer: { cancel: () => void } | undefined
let amostraTimer: { cancel: () => void } | undefined
/** Uma pergunta por vez: um Expediente lento não acumula perguntas. */
let polling = false

/** O ambiente da sessão, lido uma vez por carga (cada nome escrito por extenso, como a análise exige). */
async function readEnv($: EngineInterface): Promise<ModEnv> {
  if (env) return env
  const home = (await $.env.get('HOME'))?.trim() || undefined
  const configDir = configDirOf(await $.env.get('CLAUDE_CONFIG_DIR'), home)
  const next: ModEnv = {
    port: portOf(await $.env.get('EXPEDIENTE_PORT')),
    usageDir: usageDirOf(await $.env.get('EXPEDIENTE_USAGE_DIR'), home),
  }
  if (configDir) {
    next.configDir = configDir
    const accountId = accountIdOf(configDir)
    if (accountId) next.accountId = accountId
  }
  env = next
  return next
}

/** Grava o uso desta conta (se houver janelas e algo mudou ou já passou o intervalo). Pode lançar: quem chama engole. */
async function writeUsage($: EngineInterface, rateLimits: readonly SessionRateLimit[]): Promise<void> {
  if (!rateLimits.length) return
  const e = await readEnv($)
  if (!e.configDir || !e.usageDir) return
  const now = await $.clock.now()
  const rec = usageRecord(rateLimits, e.configDir, now)
  if (!rec) return
  const file = `${e.usageDir}/${rec.accountId}.json`
  const key = JSON.stringify([file, rec.configDir, rec.five_hour, rec.seven_day])
  if (lastWrite && lastWrite.key === key && now - lastWrite.at >= 0 && now - lastWrite.at < MIN_REWRITE_MS) return
  // $.fs.write cria a pasta se faltar e NÃO é atômico: o leitor do servidor ignora uma leitura pela
  // metade e fica com o último registro bom (server/accounts/statusline.ts).
  await $.fs.write(file, `${JSON.stringify(rec)}\n`)
  lastWrite = { key, at: now }
}

/** GET (ou POST com corpo JSON) no Expediente local com prazo de 2 s; undefined = fora do ar ou lento demais. Nunca lança. */
async function getExpediente($: EngineInterface, port: number, path: string, post?: string): Promise<HttpResponse | undefined> {
  let wait: { cancel: () => void } | undefined
  const timeout = new Promise<undefined>((resolve) => {
    wait = $.clock.after(FETCH_TIMEOUT_MS, () => resolve(undefined))
  })
  try {
    const init = post === undefined ? { headers: { accept: 'application/json' } } : { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: post }
    return await Promise.race([$.http.fetch(`http://127.0.0.1:${port}${path}`, init), timeout])
  } catch {
    return undefined
  } finally {
    wait?.cancel()
  }
}

/** GET /api/mod/summary; nunca lança. */
async function askExpediente($: EngineInterface, port: number, query: string): Promise<Asked> {
  try {
    const res = await getExpediente($, port, `/api/mod/summary${query}`)
    if (!res) return { kind: 'offline' }
    // 404 JSON = um Expediente de antes do mod (rota desconhecida); outro 404 qualquer = não é o Expediente.
    if (res.status === 404 && res.text.includes('rota desconhecida')) return { kind: 'outdated' }
    const summary = res.ok ? parseSummary(res.text) : undefined
    return summary ? { kind: 'ok', summary } : { kind: 'offline' }
  } catch {
    return { kind: 'offline' }
  }
}

/** Troca a linha de status só quando o texto muda. */
function setStatus($: EngineInterface, text: string | undefined): void {
  if (text === lastStatus) return
  lastStatus = text
  $.ui.status(text)
}

/** (Re)agenda as perguntas: 4 s com o Expediente no ar, 30 s fora do ar. */
function schedule($: EngineInterface, ms: number): void {
  if (timer && timerMs === ms) return
  timer?.cancel()
  timerMs = ms
  timer = $.clock.every(ms, () => {
    void poll($)
  })
}

/** Por arquivo do app: o que foi lido na última vez que o tamanho ou a data mudaram. */
const cache = new Map<string, { size: number; mtimeMs: number; sessao?: SessaoApp }>()
let rodando = false

async function arquivosDoApp($: EngineInterface, appDir: string): Promise<Array<{ path: string; size: number; mtimeMs: number }>> {
  const achados: Array<{ path: string; size: number; mtimeMs: number }> = []
  // <conta>/<organização>/local_<uuid>.json
  for (const conta of await $.fs.list(appDir)) {
    if (conta.kind !== 'dir') continue
    for (const org of await $.fs.list(`${appDir}/${conta.name}`).catch(() => [])) {
      if (org.kind !== 'dir') continue
      const pasta = `${appDir}/${conta.name}/${org.name}`
      for (const f of await $.fs.list(pasta).catch(() => [])) {
        if (f.kind === 'file' && f.name.startsWith('local_') && f.name.endsWith('.json')) achados.push({ path: `${pasta}/${f.name}`, size: f.size, mtimeMs: f.mtimeMs })
      }
    }
  }
  return achados
}

/** Uma rodada da ponte. Pode lançar: quem chama engole. */
async function rodarPonte($: EngineInterface): Promise<void> {
  if (rodando) return
  rodando = true
  try {
    const home = (await $.env.get('HOME'))?.trim()
    if (!home) return
    const final = sessoesAppFileOf(home)
    const agora = await $.clock.now()
    const antigo = await $.fs.stat(final).catch(() => undefined)
    if (antigo && agora - antigo.mtimeMs >= 0 && agora - antigo.mtimeMs < FRESCO_MS) return
    const arquivos = await arquivosDoApp($, appDirOf(home)).catch(() => undefined)
    if (!arquivos) return
    const sessoes: SessaoApp[] = []
    const vistos = new Set<string>()
    for (const a of arquivos) {
      vistos.add(a.path)
      let c = cache.get(a.path)
      if (!c || c.size !== a.size || c.mtimeMs !== a.mtimeMs) {
        const sessao = await $.fs.read(a.path).then(filtrarSessaoApp, () => undefined)
        c = { size: a.size, mtimeMs: a.mtimeMs, ...(sessao ? { sessao } : {}) }
        cache.set(a.path, c)
      }
      if (c.sessao) sessoes.push(c.sessao)
    }
    for (const p of [...cache.keys()]) if (!vistos.has(p)) cache.delete(p)
    sessoes.sort((a, b) => (a.sessionId < b.sessionId ? -1 : 1))
    const tmp = `${final}.${(await $.session.id()).replace(/[^A-Za-z0-9-]/g, '')}.tmp`
    await $.fs.write(tmp, `${JSON.stringify({ geradoEm: agora, sessoes })}\n`)
    const mv = await $.process.run(['mv', '-f', tmp, final])
    if (mv.exitCode !== 0) await $.process.run(['rm', '-f', tmp])
  } finally {
    rodando = false
  }
}

/** Liga a ponte do app desktop uma vez por carga, só onde a sessão desenha (não no `claude -p`). */
async function ligarPonte($: EngineInterface): Promise<void> {
  if (ponteTimer || !(await $.session.surfaces()).length) return
  ponteTimer = $.clock.every(PONTE_MS, () => {
    void rodarPonte($).catch(() => undefined)
  })
}

let amostrando = false

/** Uma rodada do amostrador: no máximo uma amostra por hora e por conta, até 24. Pode lançar: quem chama engole. */
async function amostrarRegistro($: EngineInterface): Promise<void> {
  if (amostrando) return
  amostrando = true
  try {
    const e = await readEnv($)
    const home = (await $.env.get('HOME'))?.trim()
    if (!home || !e.configDir) return
    const hora = horaDe(await $.clock.now())
    const conta = e.accountId ?? 'conta'
    const arquivo = arquivoAmostraOf(home, hora, conta)
    const marcador = marcadorAmostraOf(home, conta)
    if ((await $.fs.stat(marcador).catch(() => undefined)) || (await $.fs.stat(arquivo).catch(() => undefined))) return
    const pasta = `${e.configDir}/sessions`
    const entradas: EntradaRegistro[] = []
    for (const f of (await $.fs.list(pasta)).slice(0, MAX_PIDS)) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
      const entrada = await $.fs.read(`${pasta}/${f.name}`).then(lerEntradaRegistro, () => undefined)
      if (entrada) entradas.push(entrada)
    }
    const vivas: EntradaRegistro[] = []
    const nomes: string[] = []
    for (const entrada of entradas) {
      let pid = entrada.pid
      let nivel = 0
      let viva = false
      while (nivel++ < MAX_NIVEIS) {
        const ps = await $.process.run(argvPaiDe(pid))
        const pai = ps.exitCode === 0 ? paiDe(ps.stdout) : undefined
        if (!pai) break
        if (nivel === 1) viva = true
        nomes.push(pai.nome)
        if (pai.ppid <= 1) break
        pid = pai.ppid
      }
      if (viva) vivas.push(entrada)
    }
    if (!vivas.length) return
    await $.fs.write(arquivo, `${JSON.stringify({ hora, registro: contarMix(vivas), programas: contarProgramas(nomes) })}\n`)
    const feitas = (await $.fs.list(pastaAmostrasOf(home)).catch(() => [])).filter((f) => ehAmostraDaConta(f.name, conta))
    if (feitas.length >= MAX_AMOSTRAS) await $.fs.write(marcador, 'concluido\n')
  } finally {
    amostrando = false
  }
}

/** Amostra já ao ligar e depois a cada 10 min (a hora vira entre uma rodada e outra), só onde a sessão desenha. */
async function ligarAmostrador($: EngineInterface): Promise<void> {
  if (amostraTimer || !(await $.session.surfaces()).length) return
  amostraTimer = $.clock.every(AMOSTRA_MS, () => {
    void amostrarRegistro($).catch(() => undefined)
  })
  void amostrarRegistro($).catch(() => undefined)
}

/** Esta sessão fora das contas: conta e id da sessão, para o servidor tirá-la da lista junto com os subagentes. */
async function consulta($: EngineInterface, e: ModEnv): Promise<string> {
  const params = new URLSearchParams()
  if (e.accountId) params.set('account', e.accountId)
  params.set('session', await $.session.id())
  return `?${params.toString()}`
}

/** Uma rodada do aviso embaixo do prompt. Nunca lança. */
async function poll($: EngineInterface): Promise<void> {
  if (polling) return
  polling = true
  try {
    const surfaces = await $.session.surfaces()
    if (!surfaces.length) {
      setStatus($, undefined)
      return
    }
    const e = await readEnv($)
    const asked = await askExpediente($, e.port, await consulta($, e))
    if (asked.kind !== 'ok') {
      setStatus($, undefined)
      schedule($, OFFLINE_POLL_MS)
      return
    }
    schedule($, POLL_MS)
    setStatus($, statusText(asked.summary.waiting))
  } catch {
    // silêncio: a próxima rodada tenta de novo
  } finally {
    polling = false
  }
}

// ---------------------------------------------------------------------------------------------
// Painel do /escritorio
// ---------------------------------------------------------------------------------------------

const PAINEL = 'escritorio'
/** O nonce do /ir vale 60 s e só abre uma vez: com o painel aberto, renova a cada 15 s. */
export const RENOVA_MS = 15_000
const FOCO_VALIDO_MS = 5 * 60_000
const MAX_SESSOES_PAINEL = 20

interface EstadoPainel {
  resumo: Summary
  ir: Map<string, IrView>
  porta: number
}

let painel: EstadoPainel | undefined
let desenhadoEm = 0
let renovador: { cancel: () => void } | undefined
/** Painel do zellij (ou tty) de cada sessão viva de terminal, lido uma vez e guardado por 5 min. */
const focos = new Map<string, { em: number; zellij?: PainelZellij; tty?: string }>()

interface FocoLido {
  /** O pid ainda é o `claude`: sem isso nada mais é lido. */
  confirmado: boolean
  zellij?: PainelZellij
  tty?: string
}

/** Lê só as duas variáveis do zellij do processo (argvLeitorPainel); sem elas, o tty para o ramo genérico. */
async function lerFoco($: EngineInterface, pid: number): Promise<FocoLido> {
  const achado: FocoLido = { confirmado: false }
  try {
    const programa = await $.process.run(argvProgramaDe(pid), { timeoutMs: 5_000 })
    if (programa.exitCode !== 0 || !ehClaude(programa.stdout)) return achado
    achado.confirmado = true
    const lido = await $.process.run(argvLeitorPainel(pid), { timeoutMs: 5_000 })
    const zellij = lerPainel(lido.stdout)
    if (zellij) achado.zellij = zellij
    else {
      const tty = lerTty((await $.process.run(argvTtyDe(pid), { timeoutMs: 5_000 })).stdout)
      if (tty) achado.tty = tty
    }
  } catch {
    // sem $.process (sessão do app) ou processo que sumiu: sem foco, fica a cópia do comando
  }
  return achado
}

/** O foco de cada sessão do painel, lido uma vez e guardado por 5 min. */
async function acharFoco($: EngineInterface, id: string): Promise<{ zellij?: PainelZellij; tty?: string } | undefined> {
  const pid = pidDoId(id)
  if (!pid) return undefined
  const agora = await $.clock.now()
  const guardado = focos.get(id)
  if (guardado && agora - guardado.em < FOCO_VALIDO_MS) return guardado
  const { zellij, tty } = await lerFoco($, pid)
  const achado = { em: agora, ...(zellij ? { zellij } : {}), ...(tty ? { tty } : {}) }
  focos.set(id, achado)
  return achado
}

/** Busca o resumo (sem esta sessão) e, onde a sessão desenha, o caminho de cada sessão principal. */
async function atualizarPainel($: EngineInterface): Promise<Asked> {
  const e = await readEnv($)
  const asked = await askExpediente($, e.port, await consulta($, e))
  if (asked.kind !== 'ok') return asked
  const ir = new Map<string, IrView>()
  const surfaces = await $.session.surfaces()
  if (surfaces.length) {
    const principais = asked.summary.usage.filter((u) => u.kind === 'main').slice(0, MAX_SESSOES_PAINEL)
    await Promise.all(
      principais.map(async (u) => {
        const res = await getExpediente($, e.port, `/api/agentes/${encodeURIComponent(u.id)}/ir`)
        const v = res?.ok ? lerIr(res.text) : undefined
        if (!v) return
        ir.set(u.id, v)
        if (surfaces.includes('terminal') && v.estado === 'vivo' && v.origin === 'terminal' && v.comando.endsWith(' --fork-session')) await acharFoco($, u.id)
      }),
    )
  }
  painel = { resumo: asked.summary, ir, porta: e.port }
  $.ui.invalidate('ui.render')
  return asked
}

/** Com o painel desenhado há pouco, renova nonce e números. Nunca lança. */
async function renovar($: EngineInterface): Promise<void> {
  try {
    if ((await $.clock.now()) - desenhadoEm > 2 * RENOVA_MS) return
    await atualizarPainel($)
  } catch {
    // a próxima rodada tenta de novo
  }
}

async function abrirNoApp($: EngineInterface, url: string): Promise<void> {
  await abrirUrl(
    (argv) => $.process.run(argv, { timeoutMs: 10_000 }),
    (texto) => $.ui.toast(texto),
    url,
  )
}

async function copiarComando($: EngineInterface, comando: string, surface: RenderSurface): Promise<void> {
  const copiado = await $.ui.copy({ text: comando, surface })
  $.ui.toast(copiado.isCopied ? 'Expediente: comando copiado' : 'Expediente: não deu para copiar o comando')
}

/** Painel do zellij e WezTerm à frente (provado ao vivo), ou o terminal genérico pelo tty. Nunca lança. */
async function executarFoco($: EngineInterface, foco: { zellij?: PainelZellij; tty?: string } | undefined): Promise<boolean> {
  try {
    if (foco?.zellij) {
      for (const argv of [argvFocoZellij(foco.zellij), argvTrazerWezTerm()]) {
        if ((await $.process.run(argv, { timeoutMs: 10_000 })).exitCode !== 0) return false
      }
      return true
    }
    if (foco?.tty) {
      for (const app of ['Terminal', 'iTerm2'] as const) {
        if ((await $.process.run(argvAppRodando(app), { timeoutMs: 5_000 })).exitCode !== 0) continue
        const r = await $.process.run(argvFocoTerminalApp(app, foco.tty), { timeoutMs: 10_000 })
        if (r.exitCode === 0 && r.stdout.trim() === 'ok') return true
      }
    }
  } catch {
    return false
  }
  return false
}

/** Botão Focar do painel; sem painel achado ou com falha, copia o comando seguro. */
async function focar($: EngineInterface, id: string, comando: string, surface: RenderSurface): Promise<void> {
  if (await executarFoco($, focos.get(id))) return
  $.ui.toast('Expediente: não achei o painel dessa sessão')
  await copiarComando($, comando, surface)
}

/** Pedido do navegador: relê o pid na hora (nada de cache) e roda o mesmo plano do botão. */
async function focarPedido($: EngineInterface, pid: number): Promise<ResultadoFoco> {
  const foco = await lerFoco($, pid)
  if (!foco.confirmado) return 'nao-e-claude'
  return (await executarFoco($, foco)) ? 'focado' : 'sem-painel'
}

let focosTimer: { cancel: () => void } | undefined
let focosAte = 0
let atendendo = false

/** Uma rodada de pedidos do navegador: só onde há terminal, só com o Expediente no ar, só o que este mod assume. Nunca lança. */
async function atenderFocos($: EngineInterface): Promise<void> {
  if (atendendo) return
  atendendo = true
  try {
    const agora = await $.clock.now()
    if (agora < focosAte) return
    if (!(await $.session.surfaces()).includes('terminal')) return
    const e = await readEnv($)
    const lista = await getExpediente($, e.port, '/api/mod/focos')
    if (!lista?.ok) {
      focosAte = agora + FOCO_OFFLINE_MS
      return
    }
    for (const p of lerPedidos(lista.text)) {
      const base = `/api/mod/focos/${p.token}`
      const assumido = await getExpediente($, e.port, `${base}/assumir`, '{}')
      const pid = assumido?.ok ? lerPidAssumido(assumido.text) : undefined
      if (pid === undefined) continue
      const resultado = await focarPedido($, pid)
      await getExpediente($, e.port, `${base}/resultado`, JSON.stringify({ resultado }))
    }
  } catch {
    // a próxima rodada tenta de novo
  } finally {
    atendendo = false
  }
}

function ligarFocos($: EngineInterface): void {
  focosTimer ??= $.clock.every(FOCO_POLL_MS, () => {
    void atenderFocos($)
  })
}

/** O texto do /escritorio e, onde a sessão desenha, o painel aberto. */
async function expedienteText($: EngineInterface): Promise<string> {
  const e = await readEnv($)
  const url = `http://localhost:${e.port}`
  const asked = await atualizarPainel($)
  if (asked.kind === 'outdated') return outdatedText(url)
  if (asked.kind === 'offline') return offlineText(url)
  if ((await $.session.surfaces()).length) {
    renovador ??= $.clock.every(RENOVA_MS, () => {
      void renovar($)
    })
    try {
      await $.ui.open({ id: PAINEL, title: 'Escritório' })
    } catch {
      // sem painel, o texto basta
    }
  }
  return summaryText(asked.summary, url)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    try {
      await $.command.register({ name: 'escritorio', description: 'Resumo do Expediente: quantos agentes, quem trabalha e quem precisa de você' })
    } catch {
      // sem o comando, o resto segue
    }
    try {
      const usage = await $.session.usage()
      await writeUsage($, usage.rateLimits)
    } catch {
      // falha ao gravar = silêncio (o Expediente continua com o último número que tinha)
    }
    try {
      schedule($, POLL_MS)
    } catch {
      // sem o aviso embaixo do prompt, o resto segue
    }
    try {
      ligarFocos($)
    } catch {
      // sem o foco pelo navegador, o resto segue
    }
    try {
      await ligarPonte($)
    } catch {
      // sem a ponte, o resto segue
    }
    try {
      await ligarAmostrador($)
    } catch {
      // sem a amostra, o resto segue
    }
    return next(e)
  })

  // Depois de cada turno e quando um limite anda um ponto. `e` traz os mesmos números de
  // `$.session.usage()` naquele instante, então não há por que perguntar de novo.
  on('session.measure', async ($, e, next) => {
    try {
      await writeUsage($, e.rateLimits)
    } catch {
      // falha ao gravar = silêncio
    }
    return next(e)
  })

  on('command.run', { command: 'escritorio' }, async ($) => {
    try {
      return { text: await expedienteText($) }
    } catch {
      return { text: offlineText(`http://localhost:${env?.port ?? DEFAULT_PORT}`) }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PAINEL }, async ($, e) => {
    const { Box, Text, Button, Link, Code } = $.ui.resolve(e)
    desenhadoEm = await $.clock.now()
    if (!painel) return <Text dimColor>Rode /escritorio para carregar a lista.</Text>
    const { resumo, ir, porta } = painel
    const linhas = listaTexto([], resumo.self)
    return (
      <Box flexDirection="column">
        {linhas.map((l) => (
          <Text dimColor>{l}</Text>
        ))}
        {porEstado(resumo.usage).map((g) => (
          <Box flexDirection="column">
            <Text bold>{`${g.titulo} (${g.sessoes.length})`}</Text>
            {g.sessoes.map((u) => {
              const v = ir.get(u.id)
              const foco = focos.get(u.id)
              const acoes = v ? acoesDaSessao({ superficie: e.surface, id: u.id, porta, ir: v, focavel: !!(foco?.zellij || foco?.tty) }) : []
              return (
                <Box key={u.id} flexDirection="column">
                  <Text>{nomeDaLinha(u)}</Text>
                  {detalheTexto(u) ? <Text dimColor>{detalheTexto(u)}</Text> : undefined}
                  {acoes.map((a) => {
                    if (a.tipo === 'app') {
                      return (
                        <Box>
                          <Link href={a.href} label="Abrir no app" />
                          <Button key={`abrir:${u.id}`} label="Abrir" onPress={() => void abrirNoApp($, a.href)} />
                        </Box>
                      )
                    }
                    if (a.tipo === 'app-http') return <Link href={a.href} label="Abrir no app" />
                    if (a.tipo === 'focar') return <Button key={`focar:${u.id}`} label="Focar" onPress={(p) => void focar($, u.id, v?.comando ?? '', p.surface)} />
                    if (a.tipo === 'copiar') {
                      return (
                        <Box flexDirection="column">
                          <Button key={`copiar:${u.id}`} label={a.rotulo} onPress={(p) => void copiarComando($, a.comando, p.surface)} />
                          {a.aviso ? <Text dimColor>{a.aviso}</Text> : undefined}
                        </Box>
                      )
                    }
                    return (
                      <Box flexDirection="column">
                        <Code source={a.comando} />
                        {a.aviso ? <Text dimColor>{a.aviso}</Text> : undefined}
                      </Box>
                    )
                  })}
                </Box>
              )
            })}
          </Box>
        ))}
      </Box>
    )
  })
}
