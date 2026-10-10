// Prazos do pedido de foco que o servidor e o navegador precisam combinar: o pedido não pode viver mais que a
// espera do navegador (mais uma consulta do mod), senão ele foca depois de o navegador já ter desistido.
export const ESPERA_ASSUMIR_MS = 3000;
export const CONSULTA_DO_MOD_MS = 1000;
export const PEDIDO_VALIDADE_MS = ESPERA_ASSUMIR_MS + CONSULTA_DO_MOD_MS;
