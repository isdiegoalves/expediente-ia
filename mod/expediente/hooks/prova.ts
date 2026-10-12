// A prova do token local no mod: HMAC-SHA256 (o ambiente do mod só tem `crypto.subtle.digest`, sem `sign`) e as duas
// mensagens que o servidor confere (server/token.ts). O segredo nunca sai daqui em claro: só as provas.

const BLOCO = 64
const PROVA_FORMATO = /^[0-9a-f]{64}$/

export function hexParaBytes(hex: string): Uint8Array {
  return Uint8Array.from(hex.match(/../g) ?? [], (par) => Number.parseInt(par, 16))
}

export function bytesParaHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// Constantes do SHA-256 (FIPS 180-4): as raízes cúbicas das partes fracionárias dos 64 primeiros primos.
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/**
 * SHA-256 em JavaScript puro e síncrono. O `crypto.subtle.digest` do ambiente do mod resolve fora da fila de microtarefas, e o relógio
 * simulado dos testes só espera microtarefas; o resultado aqui é conferido contra os vetores do NIST e contra o `node:crypto`.
 */
export function sha256(dados: Uint8Array): Uint8Array {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const total = ((dados.length + 9 + 63) >> 6) << 6
  const m = new Uint8Array(total)
  m.set(dados)
  m[dados.length] = 0x80
  const vista = new DataView(m.buffer)
  vista.setUint32(total - 8, Math.floor(dados.length / 0x20000000))
  vista.setUint32(total - 4, (dados.length << 3) >>> 0)
  const w = new Uint32Array(64)
  const x = (i: number): number => w[i] as number
  for (let desvio = 0; desvio < total; desvio += 64) {
    for (let i = 0; i < 16; i++) w[i] = vista.getUint32(desvio + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(x(i - 15), 7) ^ rotr(x(i - 15), 18) ^ (x(i - 15) >>> 3)
      const s1 = rotr(x(i - 2), 17) ^ rotr(x(i - 2), 19) ^ (x(i - 2) >>> 10)
      w[i] = x(i - 16) + s0 + x(i - 7) + s1
    }
    let [a, b, c, d, e, f, g, hh] = h as unknown as number[]
    for (let i = 0; i < 64; i++) {
      const t1 = (hh as number) + (rotr(e as number, 6) ^ rotr(e as number, 11) ^ rotr(e as number, 25)) + (((e as number) & (f as number)) ^ (~(e as number) & (g as number))) + (K[i] as number) + x(i)
      const t2 = (rotr(a as number, 2) ^ rotr(a as number, 13) ^ rotr(a as number, 22)) + (((a as number) & (b as number)) ^ ((a as number) & (c as number)) ^ ((b as number) & (c as number)))
      hh = g
      g = f
      f = e
      e = ((d as number) + t1) | 0
      d = c
      c = b
      b = a
      a = (t1 + t2) | 0
    }
    ;[a, b, c, d, e, f, g, hh].forEach((v, i) => {
      h[i] = (h[i] as number) + (v as number)
    })
  }
  const saida = new Uint8Array(32)
  const vistaDaSaida = new DataView(saida.buffer)
  h.forEach((v, i) => vistaDaSaida.setUint32(i * 4, v))
  return saida
}

function emBloco(chave: Uint8Array, xor: number): Uint8Array {
  const bloco = new Uint8Array(BLOCO).fill(xor)
  chave.forEach((b, i) => {
    bloco[i] = (bloco[i] as number) ^ b
  })
  return bloco
}

function juntar(a: Uint8Array, b: Uint8Array): Uint8Array {
  const todo = new Uint8Array(a.length + b.length)
  todo.set(a)
  todo.set(b, a.length)
  return todo
}

/** HMAC-SHA256 (RFC 2104) com uma chave de até 64 bytes (a do token tem 32). */
export function hmacSha256(chave: Uint8Array, mensagem: string): string {
  if (chave.length > BLOCO) throw new Error('chave maior que o bloco')
  const dentro = sha256(juntar(emBloco(chave, 0x36), new TextEncoder().encode(mensagem)))
  return bytesParaHex(sha256(juntar(emBloco(chave, 0x5c), dentro)))
}

const bytesDe = (hex: string): Uint8Array => hexParaBytes(hex)

/** Uma chave por papel, derivadas de K (a do arquivo): a página só recebe a do cliente e não produz a prova do servidor. */
export const chaveDoCliente = (k: Uint8Array): Uint8Array => bytesDe(hmacSha256(k, 'expediente/cliente'))
export const chaveDoServidor = (k: Uint8Array): Uint8Array => bytesDe(hmacSha256(k, 'expediente/servidor'))

/** O que o servidor responde ao nonce do cliente: só quem tem K sabe (chave do servidor). */
export const provaDoServidor = (k: Uint8Array, nonce: string): string => hmacSha256(chaveDoServidor(k), `servidor\n${nonce}`)

/** O que o cliente manda numa chamada: preso ao desafio, ao método e ao caminho com a consulta (chave do cliente). */
export const provaDoCliente = (k: Uint8Array, desafio: string, metodo: string, caminho: string): string => hmacSha256(chaveDoCliente(k), `cliente\n${desafio}\n${metodo}\n${caminho}`)

/** Comparação que não para no primeiro byte diferente. */
export function iguaisHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diferenca = 0
  for (let i = 0; i < a.length; i++) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diferenca === 0
}

export function nonceAleatorio(): string {
  return bytesParaHex(crypto.getRandomValues(new Uint8Array(16)))
}

/** O texto do arquivo do token vira a chave dos HMAC; fora do formato (64 hexadecimais minúsculos), não vira. */
export function chaveDoArquivo(texto: string): Uint8Array | undefined {
  const token = texto.trim()
  return PROVA_FORMATO.test(token) ? hexParaBytes(token) : undefined
}
