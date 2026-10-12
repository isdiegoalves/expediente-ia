// Lista permitida do `open` no host: o argv só existe para as URLs do Claude que o Expediente sabe montar e para o arquivo temporário
// que redireciona ao escritório. A URL do escritório, que leva o bilhete de uso único, nunca vai para um argv: outro usuário da
// máquina a leria com `ps`. `open` de um arquivo local executa o que o sistema associar à extensão, então esse caso não aceita só um
// formato: o caminho tem de ser IGUAL ao que o mod acabou de criar (guardado em `Criado`) e, ainda assim, ter o formato.
const APP = /^claude:\/\/code\/(?:continue|needs-input)\?session=local_[A-Za-z0-9-]{1,64}$/
const RESUME = /^claude:\/\/resume\?session=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// A pasta que `mktemp -d` cria (modo 700) para o HTML do redirecionamento: dentro de uma pasta temporária do usuário, com o nome do
// modelo do mktemp e nenhum segmento `.` ou `..`.
const PASTA = /^(?:\/private)?\/(?:var\/folders|tmp)\/(?:(?!\.\.?\/)[A-Za-z0-9_.-]+\/)*expediente-abrir\.[A-Za-z0-9.]{4,40}$|^\/run\/user\/\d+\/(?:(?!\.\.?\/)[A-Za-z0-9_.-]+\/)*expediente-abrir\.[A-Za-z0-9.]{4,40}$/
const ARQUIVO = 'abrir.html'
// O escritório com o bilhete no fragmento (que o navegador não manda ao servidor): só o IP literal, a porta e `#b=` com 32 hexadecimais.
const ESCRITORIO = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/#b=[0-9a-f]{32}$/

/** O que o mod criou: a pasta que o mktemp devolveu e o único arquivo que ele grava nela. */
export interface Criado {
  pasta: string
  arquivo: string
}

export const argvMktemp = ['mktemp', '-d', '-t', 'expediente-abrir.XXXXXXXX']

export function ehUrlDoEscritorio(url: string): boolean {
  const m = typeof url === 'string' ? ESCRITORIO.exec(url) : null
  return !!m && Number(m[1]) <= 65_535
}

/** O que o mod cria a partir do que o `mktemp` imprimiu, ou undefined se a pasta não tem a forma esperada. */
export function criadoDoMktemp(saida: string): Criado | undefined {
  const pasta = typeof saida === 'string' ? saida.trim() : ''
  return PASTA.test(pasta) ? { pasta, arquivo: `${pasta}/${ARQUIVO}` } : undefined
}

const confere = (candidato: string, criado: Criado): boolean => typeof candidato === 'string' && candidato === criado.arquivo && PASTA.test(criado.pasta) && criado.arquivo === `${criado.pasta}/${ARQUIVO}`

/** O HTML que leva o navegador ao escritório: só para uma URL da forma estrita (nada dela precisa de escape). */
export function htmlDoEscritorio(url: string): string | undefined {
  if (!ehUrlDoEscritorio(url)) return undefined
  return `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0;url=${url}">\n<title>Expediente</title>\n<a href="${url}">Abrir o escritório</a>\n`
}

export const argvChmod = (arquivo: string, criado: Criado): string[] | undefined => (confere(arquivo, criado) ? ['chmod', '600', arquivo] : undefined)

/** O `open` do arquivo temporário: só o caminho igual ao que o mod criou. */
export const argvAbrirArquivo = (arquivo: string, criado: Criado): string[] | undefined => (confere(arquivo, criado) ? ['open', arquivo] : undefined)

/** Limpeza sem `rm -rf`: o arquivo exato e, se a pasta ficou vazia, a pasta exata. Sobrou algo? O `rmdir` falha e nada mais é apagado. */
export const argvLimpeza = (criado: Criado): string[][] | undefined =>
  confere(criado.arquivo, criado) ? [['rm', '-f', criado.arquivo], ['rmdir', criado.pasta]] : undefined

export function argvAbrir(url: string): string[] | undefined {
  if (typeof url !== 'string') return undefined
  return APP.test(url) || RESUME.test(url) ? ['open', url] : undefined
}

/** A guarda fica aqui, no ponto que executa: `run` só recebe o argv que a lista permitida devolve. */
export async function abrirUrl(run: (argv: string[]) => Promise<unknown>, toast: (texto: string) => void, url: string): Promise<void> {
  const argv = argvAbrir(url)
  if (!argv) {
    toast('Expediente: link recusado, fora da lista permitida')
    return
  }
  try {
    await run(argv)
  } catch {
    toast('Expediente: não deu para abrir o app')
  }
}
