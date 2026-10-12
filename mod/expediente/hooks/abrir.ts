// Lista permitida do `open` no host: o argv só existe para as URLs do Claude que o Expediente sabe montar e para o arquivo
// temporário que redireciona ao escritório. A URL do escritório, que leva o bilhete de uso único, nunca vai para um argv:
// outro usuário da máquina a leria com `ps`.
const APP = /^claude:\/\/code\/(?:continue|needs-input)\?session=local_[A-Za-z0-9-]{1,64}$/
const RESUME = /^claude:\/\/resume\?session=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
// A pasta que `mktemp -d` cria (modo 700) para o HTML do redirecionamento; nenhum segmento `.` ou `..`.
const PASTA = /^\/(?:(?!\.\.?\/)[A-Za-z0-9_.-]+\/)+expediente-abrir\.[A-Za-z0-9.]{4,40}$/
const ARQUIVO = 'abrir.html'
// O escritório com o bilhete no fragmento (que o navegador não manda ao servidor): só o IP literal, a porta e `#b=` com 32 hexadecimais.
const ESCRITORIO = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/#b=[0-9a-f]{32}$/

export const argvMktemp = ['mktemp', '-d', '-t', 'expediente-abrir.XXXXXXXX']

export function ehUrlDoEscritorio(url: string): boolean {
  const m = typeof url === 'string' ? ESCRITORIO.exec(url) : null
  return !!m && Number(m[1]) <= 65_535
}

/** A pasta que o `mktemp` imprimiu, ou undefined se não tem a forma esperada. */
export function pastaTemporaria(saida: string): string | undefined {
  const pasta = typeof saida === 'string' ? saida.trim() : ''
  return PASTA.test(pasta) ? pasta : undefined
}

export const arquivoDoEscritorio = (pasta: string): string => `${pasta}/${ARQUIVO}`

/** O HTML que leva o navegador ao escritório: só para uma URL da forma estrita (nada dela precisa de escape). */
export function htmlDoEscritorio(url: string): string | undefined {
  if (!ehUrlDoEscritorio(url)) return undefined
  return `<!doctype html>\n<meta charset="utf-8">\n<meta http-equiv="refresh" content="0;url=${url}">\n<title>Expediente</title>\n<a href="${url}">Abrir o escritório</a>\n`
}

export function argvChmod(arquivo: string): string[] | undefined {
  return arquivo.endsWith(`/${ARQUIVO}`) && pastaTemporaria(arquivo.slice(0, -ARQUIVO.length - 1)) ? ['chmod', '600', arquivo] : undefined
}

export function argvLimpar(pasta: string): string[] | undefined {
  return pastaTemporaria(pasta) === pasta ? ['rm', '-rf', pasta] : undefined
}

export function argvAbrir(url: string): string[] | undefined {
  if (typeof url !== 'string') return undefined
  if (APP.test(url) || RESUME.test(url)) return ['open', url]
  return url.endsWith(`/${ARQUIVO}`) && pastaTemporaria(url.slice(0, -ARQUIVO.length - 1)) ? ['open', url] : undefined
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
