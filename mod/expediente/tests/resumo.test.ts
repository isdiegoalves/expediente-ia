// O texto do /escritorio resumo: lê a resposta do servidor e escreve contagens e a última tarefa de cada sessão.
import { describe, expect, test } from 'claude-code/testing'
import { duracaoTexto, parseResumo, resumoTexto } from '../hooks/resumo'

const AGORA = 10_000_000

const corpo = JSON.stringify({
  desde: AGORA - 2 * 3_600_000 - 5 * 60_000,
  agora: AGORA,
  terminaram: 2,
  travaram: 1,
  esperam: 1,
  trabalhando: 1,
  sessoes: [
    { id: 'a:1', nome: 'Ana', sala: 'loja', estado: 'espera', motivo: 'aprovar uma permissão', tarefa: { rotulo: 'Em andamento', texto: 'Escrevendo testes' }, desde: AGORA - 1000 },
    { id: 'a:2', nome: 'Bia', sala: 'site', estado: 'travou', motivo: 'revisor: API 529', desde: AGORA - 2000 },
    { id: 'a:3', nome: 'Caio', sala: 'api', estado: 'terminou', tarefa: { rotulo: 'Último pedido', texto: 'Revisar o PR' }, desde: AGORA - 3000 },
    { id: 'a:4', nome: 'Duda', sala: 'api', estado: 'terminou', desde: AGORA - 4000 },
    { id: 'a:5', nome: 'Eva', sala: 'api', estado: 'trabalhando', desde: AGORA - 5000 },
    { nome: 'sem estado', sala: 'x', estado: 'inventado', desde: 1 },
  ],
})

describe('parseResumo', () => {
  test('lê o que o servidor manda e descarta o que não tem forma de sessão', () => {
    const r = parseResumo(corpo)
    expect(r?.sessoes.map((s) => s.nome)).toEqual(['Ana', 'Bia', 'Caio', 'Duda', 'Eva'])
    expect(r?.esperam).toBe(1)
    expect(parseResumo('não é json')).toBeUndefined()
    expect(parseResumo('{"sessoes": 1}')).toBeUndefined()
  })
})

describe('duracaoTexto', () => {
  test('minutos, horas com minutos e dias', () => {
    expect(duracaoTexto(10_000)).toBe('menos de 1 min')
    expect(duracaoTexto(35 * 60_000)).toBe('35 min')
    expect(duracaoTexto(2 * 3_600_000 + 5 * 60_000)).toBe('2 h 5 min')
    expect(duracaoTexto(2 * 3_600_000)).toBe('2 h')
    expect(duracaoTexto(72 * 3_600_000)).toBe('3 dias')
  })
})

describe('resumoTexto', () => {
  test('contagens no alto e, por estado, cada sessão com o motivo e a última tarefa', () => {
    const texto = resumoTexto(parseResumo(corpo)!, 'http://localhost:4848')
    expect(texto.split('\n')).toEqual([
      'Desde que você saiu, há 2 h 5 min · Expediente em http://localhost:4848',
      '2 terminaram · 1 travou · 1 espera você · 1 trabalhando',
      'Esperam você (1)',
      '  Ana · loja · aprovar uma permissão',
      '    Em andamento: Escrevendo testes',
      'Travaram (1)',
      '  Bia · site · revisor: API 529',
      'Terminaram (2)',
      '  Caio · api',
      '    Último pedido: Revisar o PR',
      '  Duda · api',
      'Trabalhando (1)',
      '  Eva · api',
    ])
  })

  test('sem outras sessões diz isso', () => {
    const vazio = JSON.stringify({ desde: 0, agora: 60_000, terminaram: 0, travaram: 0, esperam: 0, trabalhando: 0, sessoes: [] })
    expect(resumoTexto(parseResumo(vazio)!, 'http://localhost:4848')).toContain('Nenhuma outra sessão aberta.')
  })
})
