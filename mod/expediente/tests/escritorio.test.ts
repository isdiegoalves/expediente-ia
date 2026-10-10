// Lista por estado e escolha da ação de cada sessão. Funções puras: nada aqui executa comando nem abre link.
import { describe, expect, test } from 'claude-code/testing'
import { acoesDaSessao, contextoTexto, custoTexto, lerIr, lerUso, listaTexto, pidDoId, type IrView, type UsoAgente } from '../hooks/escritorio'

const NONCE = 'a'.repeat(32)
const APP = 'claude://code/continue?session=local_11111111-2222-3333-4444-555555555555'

function uso(id: string, status: string, over: Partial<UsoAgente> = {}): UsoAgente {
  return { id, name: id.toUpperCase(), kind: 'main', status, room: 'loja', compactions: 0, ...over }
}

function ir(over: Partial<IrView> = {}): IrView {
  return { estado: 'vivo', origin: 'terminal', comando: 'claude --resume s1 --fork-session', aviso: 'cria uma cópia, não responde à sessão original', links: [], nonce: NONCE, ...over }
}

describe('lerUso', () => {
  test('lê o que o servidor manda e descarta o que não tem forma de agente', () => {
    const u = lerUso({ id: '.claude:1', name: 'Ana', kind: 'main', status: 'working', room: 'loja', title: 'Subir\ndeploy', compactions: 2, context: { tokens: 142_300, window: 1_000_000, percent: 14 }, cost: { usd: 4.5, estimated: true, unpriced: [] } })
    expect(u).toMatchObject({ id: '.claude:1', title: 'Subir deploy', compactions: 2, cost: { usd: 4.5, estimated: true } })
    expect(lerUso({ id: '.claude:1' })).toBeUndefined()
    expect(lerUso({ id: 'x', name: 'n', kind: 'main', status: 'working', room: 'r', compactions: -1 })).toMatchObject({ compactions: 0 })
    expect(lerUso('texto')).toBeUndefined()
    expect(lerUso({ id: 'x', name: 'n', kind: 'main', status: 'idle', room: 'r', compactions: 0, coins: 137.9 })).toMatchObject({ coins: 137 })
    expect(lerUso({ id: 'x', name: 'n', kind: 'main', status: 'idle', room: 'r', compactions: 0, coins: -3 })?.coins).toBeUndefined()
  })
})

describe('texto de contexto e custo', () => {
  test('contexto com e sem janela; custo exato, estimado e modelo sem preço', () => {
    expect(contextoTexto({ tokens: 142_300, window: 1_000_000, percent: 14 })).toBe('142,3 k de 1 M (14%)')
    expect(contextoTexto({ tokens: 900 })).toBe('900 tokens')
    expect(custoTexto({ usd: 2, estimated: false, unpriced: [] })).toBe('US$ 2,00')
    expect(custoTexto({ usd: 4.5, estimated: true, unpriced: [] })).toBe('US$ 4,50 (estimado)')
    expect(custoTexto({ estimated: true, unpriced: ['modelo-x'] })).toBe('sem preço para modelo-x')
    expect(custoTexto({ usd: 1.25, estimated: true, unpriced: ['modelo-x'] })).toBe('US$ 1,25 (estimado) · sem preço para modelo-x')
  })
})

describe('listaTexto', () => {
  test('sessões por estado, com contexto, compactações e custo; subagentes ficam de fora da lista', () => {
    const linhas = listaTexto(
      [
        uso('a:1', 'working', { name: 'Ana', title: 'Corrigir login', context: { tokens: 142_300, window: 1_000_000, percent: 14 }, compactions: 2, cost: { usd: 4.5, estimated: true, unpriced: [] } }),
        uso('a:2', 'waiting', { name: 'Bia', room: 'app' }),
        uso('a:3', 'idle', { name: 'Caio' }),
        uso('s:x', 'working', { name: 'Sub', kind: 'sub' }),
      ],
      undefined,
    )
    expect(linhas).toEqual([
      'Precisa de você (1)',
      '  Bia · app',
      'Trabalhando (1)',
      '  Ana · loja · Corrigir login',
      '    contexto 142,3 k de 1 M (14%) · compactou 2× · US$ 4,50 (estimado)',
      'Ociosas (1)',
      '  Caio · loja',
    ])
  })

  test('o saldo de moedinhas entra no detalhe de cada sessão', () => {
    expect(listaTexto([uso('a:1', 'idle', { name: 'Ana', coins: 137 })], uso('a:9', 'working', { coins: 0 }))).toEqual(['Ociosas (1)', '  Ana · loja', '    🪙 137', 'Esta sessão: 🪙 0'])
  })

  test('a própria sessão vem numa linha à parte, com contexto e custo', () => {
    const linhas = listaTexto([], uso('a:9', 'working', { name: 'Eu', context: { tokens: 50_000, window: 200_000, percent: 25 }, cost: { usd: 0.5, estimated: false, unpriced: [] } }))
    expect(linhas).toEqual(['Esta sessão: contexto 50 k de 200 k (25%) · US$ 0,50'])
  })

  test('título com quebra de linha e controle vira uma linha só e é cortado', () => {
    const linhas = listaTexto([lerUso({ ...uso('a:1', 'idle'), title: `x\u001b[31m\n${'y'.repeat(200)}` })!], undefined)
    expect(linhas[1]).not.toMatch(/[\u0000-\u001f]/)
    expect(linhas[1]!.length).toBeLessThan(120)
  })
})

describe('pidDoId', () => {
  test('o pid é o que vem depois da conta; id de subagente ou torto não tem', () => {
    expect(pidDoId('.claude:507')).toBe(507)
    expect(pidDoId('.claude-conta2:12')).toBe(12)
    expect(pidDoId('sess-1:agent-9')).toBeUndefined()
    expect(pidDoId('.claude:0')).toBeUndefined()
    expect(pidDoId('.claude:12 ; rm')).toBeUndefined()
  })
})

describe('lerIr', () => {
  test('aceita o JSON do servidor; recusa comando com controle e nonce fora do formato', () => {
    const ok = lerIr(JSON.stringify({ estado: 'vivo', origin: 'terminal', comando: 'claude attach s1', links: [{ rotulo: 'a', href: 'claude-cli://open?cwd=%2Fp' }], nonce: NONCE }))
    expect(ok).toMatchObject({ estado: 'vivo', comando: 'claude attach s1', nonce: NONCE })
    expect(lerIr(JSON.stringify({ estado: 'vivo', comando: 'claude attach s1\nrm -rf /', links: [] }))).toBeUndefined()
    expect(lerIr(JSON.stringify({ estado: 'vivo', comando: 'claude attach s1', links: [], nonce: 'x&y' }))?.nonce).toBeUndefined()
    expect(lerIr('<html>')).toBeUndefined()
  })
})

describe('acoesDaSessao', () => {
  const base = { id: '.claude:7', porta: 4848, focavel: false }

  test('sessão do app, no terminal: Link claude:// da lista permitida', () => {
    const v = ir({ origin: 'app desktop', links: [{ rotulo: 'Abrir a sessão no app', href: APP }] })
    expect(acoesDaSessao({ ...base, superficie: 'terminal', ir: v })).toEqual([{ tipo: 'app', href: APP }])
  })

  test('sessão do app, no app: Link http://localhost com o nonce, nunca o claude://', () => {
    const v = ir({ origin: 'app desktop', links: [{ rotulo: 'Abrir a sessão no app', href: APP }] })
    expect(acoesDaSessao({ ...base, superficie: 'desktop', ir: v })).toEqual([{ tipo: 'app-http', href: `http://localhost:4848/api/agentes/.claude%3A7/ir?abrir=1&n=${NONCE}` }])
  })

  test('link do app fora da lista permitida não vira ação', () => {
    const v = ir({ origin: 'app desktop', links: [{ rotulo: 'x', href: 'claude://code/continue?session=local_a&prompt=rm' }] })
    expect(acoesDaSessao({ ...base, superficie: 'terminal', ir: v }).some((a) => a.tipo === 'app')).toBe(false)
  })

  test('terminal viva com painel achado: Focar e a cópia rotulada; sem painel, só a cópia', () => {
    const v = ir()
    expect(acoesDaSessao({ ...base, superficie: 'terminal', ir: v, focavel: true })).toEqual([
      { tipo: 'focar' },
      { tipo: 'copiar', rotulo: 'Copiar comando (cria uma cópia)', comando: 'claude --resume s1 --fork-session', aviso: 'cria uma cópia, não responde à sessão original' },
    ])
    expect(acoesDaSessao({ ...base, superficie: 'terminal', ir: v })).toEqual([
      { tipo: 'copiar', rotulo: 'Copiar comando (cria uma cópia)', comando: 'claude --resume s1 --fork-session', aviso: 'cria uma cópia, não responde à sessão original' },
    ])
  })

  test('no app o comando seguro aparece para selecionar, nunca Focar nem cópia', () => {
    const acoes = acoesDaSessao({ ...base, superficie: 'desktop', ir: ir(), focavel: true })
    expect(acoes).toEqual([{ tipo: 'comando', comando: 'claude --resume s1 --fork-session', aviso: 'cria uma cópia, não responde à sessão original' }])
  })

  test('bg: claude attach, sem Focar mesmo com painel', () => {
    const v = ir({ comando: 'claude attach s1', aviso: undefined })
    expect(acoesDaSessao({ ...base, superficie: 'terminal', ir: v, focavel: true })).toEqual([{ tipo: 'copiar', rotulo: 'Copiar claude attach', comando: 'claude attach s1' }])
  })

  test('encerrada: cd e --resume sem fork', () => {
    const v = ir({ estado: 'encerrado', comando: "cd -- '/p/loja' && claude --resume s1", aviso: undefined })
    expect(acoesDaSessao({ ...base, superficie: 'terminal', ir: v, focavel: true })).toEqual([{ tipo: 'copiar', rotulo: 'Copiar comando para retomar', comando: "cd -- '/p/loja' && claude --resume s1" }])
  })

  test('--resume sem fork em sessão viva nunca é oferecido', () => {
    const v = ir({ comando: 'claude --resume s1', aviso: undefined })
    expect(acoesDaSessao({ ...base, superficie: 'terminal', ir: v, focavel: true })).toEqual([])
    expect(acoesDaSessao({ ...base, superficie: 'desktop', ir: v })).toEqual([])
  })
})
