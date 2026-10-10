// Janela "Desde que você saiu": contagens (terminaram, travaram, esperam você) e, por sessão, a última tarefa em
// andamento, sem rolagem. Abre sozinha na volta depois de uma ausência longa (net/presenca.ts) e pelo botão ou pela
// tecla R. Os números saem do snapshot que a página já tem; o servidor só guarda quando você saiu.
import { montarResumo, type ResumoView, type SessaoResumo } from '../../../shared/resumo';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setText } from './dom';
import { relativeTime } from './format';
import { ICONS } from './icons';
import { ausenciaDoMock, ausenciaTexto, ESTADO_ROTULO, MAX_LINHAS, maiorQueCabe, recortar } from './resumo-model';

const ICONE =
  '<svg class="ui-px-icon" width="20" height="20" viewBox="0 0 10 10" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
  '<path fill="currentColor" d="M1 1h8v1H1zM1 4h8v1H1zM1 7h5v1H1z"/></svg>';

const clock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

export class ResumoPanel implements UiComponent {
  readonly el: HTMLDialogElement;
  readonly button: HTMLButtonElement;
  private corpo: HTMLElement;
  private quando: HTMLElement;
  private numeros: HTMLElement;
  private lista: HTMLElement;
  private resto: HTMLElement;
  private desde: number;
  private saiuConhecida = false;
  private drawn = '';

  constructor(private ctx: UiContext) {
    const ausencia = ctx.store.mock ? ausenciaDoMock(new URLSearchParams(location.search).get('resumo')) : undefined;
    this.desde = ausencia !== undefined ? Date.now() - ausencia : Date.now();
    this.saiuConhecida = ausencia !== undefined;

    this.button = iconButton(ICONE, 'Resumo: o que mudou desde que você saiu (R)', () => this.toggle());
    this.button.setAttribute('aria-haspopup', 'dialog');
    const close = iconButton(ICONS.close, 'Fechar (Esc)', () => this.close(), 'ui-icon-btn--sm');
    this.quando = h('p', { class: 'ui-resumo__quando' });
    this.numeros = h('div', { class: 'ui-resumo__numeros' });
    this.lista = h('ol', { class: 'ui-resumo__lista' });
    this.resto = h('p', { class: 'ui-resumo__resto', hidden: true });
    this.corpo = h('div', { class: 'ui-resumo__corpo' }, this.quando, this.numeros, this.lista, this.resto);
    this.el = h(
      'dialog',
      { class: 'ui-dialog ui-resumo', attrs: { 'aria-labelledby': 'ui-resumo-title' } },
      h('div', { class: 'ui-dialog__head' }, h('h2', { text: 'Desde que você saiu', attrs: { id: 'ui-resumo-title' } }), close),
      this.corpo,
    );
    this.el.addEventListener('click', (e) => {
      if (e.target === this.el) this.close();
    });
    this.el.addEventListener('keydown', (e) => e.stopPropagation());
    this.el.addEventListener('close', () => this.button.setAttribute('aria-expanded', 'false'));
  }

  get isOpen(): boolean {
    return this.el.open;
  }

  /** O servidor informou quando a última aba saiu; null mantém o que havia. */
  definirSaida(saiuEm: number | null): void {
    if (saiuEm === null) return;
    this.desde = saiuEm;
    this.saiuConhecida = true;
  }

  open(): void {
    if (this.el.open) return;
    this.el.showModal();
    this.button.setAttribute('aria-expanded', 'true');
    this.drawn = '';
    this.render();
  }

  close(): void {
    if (this.el.open) this.el.close();
  }

  toggle(): void {
    if (this.el.open) this.close();
    else this.open();
  }

  render(): void {
    if (!this.el.open) return;
    const snap = this.ctx.store.snapshot;
    if (!snap) {
      setText(this.quando, 'Carregando o escritório…');
      return;
    }
    const agora = this.ctx.now();
    const view = montarResumo(snap, this.desde, agora);
    const key = JSON.stringify([view, window.innerHeight, this.saiuConhecida, Math.floor(agora / 60_000)]);
    if (key === this.drawn) return;
    this.drawn = key;
    this.desenhar(view);
  }

  private desenhar(view: ResumoView): void {
    setText(this.quando, `${ausenciaTexto(view, this.saiuConhecida)}, às ${clock.format(view.desde)}.`);
    const celula = (n: number, rotulo: string, estado: string) =>
      h('div', { class: `ui-resumo__num is-${estado}` }, h('strong', { text: String(n) }), h('span', { text: rotulo }));
    this.numeros.replaceChildren(
      celula(view.terminaram, view.terminaram === 1 ? 'terminou' : 'terminaram', 'terminou'),
      celula(view.travaram, view.travaram === 1 ? 'travou' : 'travaram', 'travou'),
      celula(view.esperam, view.esperam === 1 ? 'espera você' : 'esperam você', 'espera'),
      celula(view.trabalhando, 'trabalhando', 'trabalhando'),
    );
    if (!view.sessoes.length) {
      this.lista.replaceChildren(h('li', { class: 'ui-resumo__vazio', text: 'Nenhuma sessão aberta no escritório.' }));
      this.resto.hidden = true;
      return;
    }
    const corpo = this.corpo;
    const mostrar = (linhas: number): boolean => {
      const { visiveis, restantes } = recortar(view.sessoes, linhas);
      this.lista.replaceChildren(...visiveis.map((s) => this.linha(s, view.agora)));
      this.resto.hidden = restantes === 0;
      setText(this.resto, restantes === 1 ? 'e mais 1 sessão' : `e mais ${restantes} sessões`);
      return corpo.scrollHeight <= corpo.clientHeight;
    };
    mostrar(maiorQueCabe(MAX_LINHAS, mostrar));
  }

  private linha(s: SessaoResumo, agora: number): HTMLElement {
    const estado = s.estado === 'ociosa' ? ESTADO_ROTULO.ociosa : `${ESTADO_ROTULO[s.estado]} ${relativeTime(s.desde, agora)}`;
    return h(
      'li',
      { class: `ui-resumo__linha is-${s.estado}` },
      h('span', { class: 'ui-resumo__ponto', attrs: { 'aria-hidden': 'true' } }),
      h(
        'div',
        { class: 'ui-resumo__quem' },
        h('div', { class: 'ui-resumo__nome' }, h('strong', { text: s.nome }), h('span', { text: ` · ${s.sala}` })),
        s.motivo ? h('div', { class: 'ui-resumo__motivo', text: s.motivo }) : null,
        s.tarefa ? h('div', { class: 'ui-resumo__tarefa', text: `${s.tarefa.rotulo}: ${s.tarefa.texto}` }) : null,
      ),
      h('span', { class: 'ui-resumo__estado', text: estado }),
    );
  }
}
