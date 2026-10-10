// Lista permitida do `open` no host: o argv só existe para as URLs do Claude que o Expediente sabe montar.
const APP = /^claude:\/\/code\/(?:continue|needs-input)\?session=local_[A-Za-z0-9-]{1,64}$/
const ESPERA = /^claude:\/\/code\/needs-input$/
const RESUME = /^claude:\/\/resume\?session=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function argvAbrir(url: string): string[] | undefined {
  if (typeof url !== 'string') return undefined
  return APP.test(url) || ESPERA.test(url) || RESUME.test(url) ? ['open', url] : undefined
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
