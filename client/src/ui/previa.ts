// Faixa de prévia: avisa que esta aba mostra um tema candidato (`?tema=<id>`) e que o escritório segue no tema ativo.
import { h } from './dom';

export function textoDaPrevia(nome: string): string {
  return `Prévia do tema "${nome}", só nesta aba. Para aprovar ou recusar, responda na conversa do /tema.`;
}

export function faixaDePrevia(nome: string): HTMLElement {
  return h('div', { class: 'ui-banner ui-banner--previa', role: 'status' }, h('span', { class: 'ui-banner__dot', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'ui-banner__text', text: textoDaPrevia(nome) }));
}
