// Lista permitida do `open` no host: o argv só existe para as URLs do Claude que o Expediente sabe montar.
const APP = /^claude:\/\/code\/(?:continue|needs-input)\?session=local_[A-Za-z0-9-]{1,64}$/
const RESUME = /^claude:\/\/resume\?session=[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function argvAbrir(url: string): string[] | undefined {
  if (typeof url !== 'string') return undefined
  return APP.test(url) || RESUME.test(url) ? ['open', url] : undefined
}
