// `/escritorio tema padrao`: devolve o escritório ao tema padrão. Só decisão e texto: quem grava é o register.tsx.

/** O arquivo que o servidor lê para saber o tema ativo. */
export function temaAtivoOf(home: string): string {
  return `${home}/.expediente/host/tema-ativo`
}

/** O argumento do /escritorio é o subcomando "tema padrao" (com ou sem acento, em qualquer caixa)? */
export function ehTemaPadrao(args: string): boolean {
  return /^tema\s+padr[aã]o$/i.test(args.trim())
}

export function temaPadraoOkText(): string {
  return 'Tema padrão restaurado: o escritório volta ao tema padrão sozinho em alguns segundos, sem reiniciar.'
}

export function temaRecusadoText(caminho: string): string {
  return `Não restaurei o tema padrão: ${caminho} é link simbólico ou não é um arquivo comum. Nada foi gravado.`
}

export function temaFalhouText(caminho: string): string {
  return `Não consegui gravar ${caminho}. Nada mudou; confira as permissões da pasta ~/.expediente/host.`
}

export function temaSemHomeText(): string {
  return 'Não achei a pasta pessoal desta sessão (HOME), então não sei onde gravar o tema ativo. Nada mudou.'
}
