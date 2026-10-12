// A prova do token no mod: SHA-256 e HMAC em JavaScript puro, conferidos contra os vetores do NIST (FIPS 180-4) e da RFC 4231, e as duas
// mensagens do protocolo contra os mesmos vetores do servidor (server/test/prova-vetores.test.ts), conferidos com openssl.
import { describe, expect, test } from 'claude-code/testing'
import { bytesParaHex, chaveDoArquivo, hexParaBytes, hmacSha256, iguaisHex, nonceAleatorio, provaDoCliente, provaDoServidor, sha256 } from '../hooks/prova'

const texto = (s: string) => new TextEncoder().encode(s)
const TOKEN = '5e17e11a'.repeat(8)
const NONCE = '0123456789abcdef0123456789abcdef'
const DESAFIO = 'fedcba9876543210fedcba9876543210'

describe('sha256', () => {
  test('vetores do NIST: vazio, "abc", duas mensagens de bloco e um milhão de "a"', () => {
    expect(bytesParaHex(sha256(texto('')))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
    expect(bytesParaHex(sha256(texto('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(bytesParaHex(sha256(texto('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1')
    expect(bytesParaHex(sha256(texto('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu')))).toBe('cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1')
    expect(bytesParaHex(sha256(texto('a'.repeat(1_000_000))))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0')
  })

  test('as bordas do preenchimento: 55, 56, 63, 64 e 65 bytes', () => {
    const esperado: Record<number, string> = {
      55: '9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318',
      56: 'b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a',
      63: '7d3e74a05d7db15bce4ad9ec0658ea98e3f06eeecf16b4c6fff2da457ddc2f34',
      64: 'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
      65: '635361c48bb9eab14198e76ea8ab7f1a41685d6ad62aa9146d301d4f17eb0ae0',
    }
    for (const [n, hex] of Object.entries(esperado)) expect(bytesParaHex(sha256(texto('a'.repeat(Number(n))))), n).toBe(hex)
  })
})

describe('hmacSha256', () => {
  test('vetores da RFC 4231 (casos 1 e 2)', () => {
    expect(hmacSha256(new Uint8Array(20).fill(0x0b), 'Hi There')).toBe('b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7')
    expect(hmacSha256(texto('Jefe'), 'what do ya want for nothing?')).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })

  test('recusa chave maior que o bloco', () => {
    expect(() => hmacSha256(new Uint8Array(65), 'x')).toThrow()
  })
})

describe('a prova do protocolo', () => {
  const chave = hexParaBytes(TOKEN)

  test('os vetores conhecidos (servidor e cliente)', () => {
    expect(provaDoServidor(chave, NONCE)).toBe('2bd2a945624115ad28aacc2465d4ed89a3135ae6f58c4e73e687f5d75ab8e4a3')
    expect(provaDoCliente(chave, DESAFIO, 'POST', '/api/permissions/p-1/decision?x=1')).toBe('2475edeaa311b39075668ed854cbc3fd23334b904640120a3925f072b6e1be94')
    expect(provaDoCliente(chave, DESAFIO, 'GET', '/api/mod/focos')).toBe('0d34a7211a64c5d2442a77242f4a59e5ada5ae83435d9f2795627537273f7385')
  })

  test('os prefixos separam as provas, e método e caminho entram na conta', () => {
    expect(provaDoCliente(chave, NONCE, 'POST', '')).not.toBe(provaDoServidor(chave, NONCE))
    expect(provaDoCliente(chave, DESAFIO, 'PUT', '/a')).not.toBe(provaDoCliente(chave, DESAFIO, 'POST', '/a'))
    expect(provaDoCliente(chave, DESAFIO, 'POST', '/a')).not.toBe(provaDoCliente(chave, DESAFIO, 'POST', '/b'))
  })

  test('a chave sai do texto do token só com 64 hexadecimais minúsculos', () => {
    expect(bytesParaHex(chaveDoArquivo(`${TOKEN}\n`)!)).toBe(TOKEN)
    for (const t of ['', 'curto', TOKEN.toUpperCase(), `${TOKEN}0`, 'g'.repeat(64)]) expect(chaveDoArquivo(t), t).toBeUndefined()
  })

  test('comparação de hexadecimais e nonce aleatório de 32 caracteres', () => {
    expect(iguaisHex('abc', 'abc')).toBe(true)
    expect(iguaisHex('abc', 'abd')).toBe(false)
    expect(iguaisHex('abc', 'abcd')).toBe(false)
    expect(nonceAleatorio()).toMatch(/^[0-9a-f]{32}$/)
    expect(nonceAleatorio()).not.toBe(nonceAleatorio())
  })
})
