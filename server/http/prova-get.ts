// Os GET que mudam estado do servidor e por isso também exigem a prova (ver guard.ts). O resto dos GET só lê.
//   wait:   entrega e apaga a decisão guardada para o hook, e registra quem espera
//   focos:  marca que há um mod de pé (muda o que o /ir oferece)
//   ir:     emite um nonce e expulsa os mais antigos do agente
// O /ir?abrir=1 fica de fora: é a navegação do navegador, que não manda cabeçalho, e o nonce de uso único é a credencial dele.
const IR = /^\/api\/agentes\/[^/]+\/ir$/;

const GET_COM_PROVA: readonly RegExp[] = [/^\/api\/permissions\/[^/]+\/wait$/, /^\/api\/mod\/focos$/, IR];

export function getExigeProva(url: URL): boolean {
  if (url.searchParams.get('abrir') === '1' && IR.test(url.pathname)) return false;
  return GET_COM_PROVA.some((re) => re.test(url.pathname));
}
