// "Ir para a sessão": pede o comando seguro ao servidor no clique (GET, nenhum POST) e o copia direto para a
// área de transferência. O comando só aparece na tela se a cópia for recusada, já selecionado.
import type { IrInfo } from '../../../shared/types';
import { copyText, h, setHidden, setText } from './dom';

export function copiadoTexto(ir: Pick<IrInfo, 'aviso'>): string {
  return ir.aviso ? `Comando copiado: ${ir.aviso}.` : 'Comando copiado.';
}

const LINK_DA_SESSAO = /^claude:\/\/code\/continue\?session=local_[A-Za-z0-9-]{1,64}$/;
const ESPERA_APP_MS = 2000;
const AVISO_ATALHOS =
  'Se o app não vier à frente, ele ignora links externos (conta desconectada ou links claude:// bloqueados por política). Use o comando copiado.';
const AVISO_SEM_RESPOSTA = 'O app não respondeu em 2 s: os atalhos externos dele podem estar desligados. Use o comando copiado.';

export function ehLinkDaSessao(href: string): boolean {
  return LINK_DA_SESSAO.test(href);
}

/** Quando o app assume o primeiro plano, a página perde o foco ou fica oculta. */
export function appRespondeu(estado: { temFoco: boolean; visivel: boolean }): boolean {
  return !estado.temFoco || !estado.visivel;
}

export function ordemTentada(ir: Pick<IrInfo, 'origin' | 'links'>): string {
  if (ir.origin !== 'app desktop') return 'Ordem tentada: a cópia segura do comando e, ao lado, o botão que abre o projeto.';
  return ir.links.some((l) => ehLinkDaSessao(l.href))
    ? 'Ordem tentada: o link da sessão no app, ao lado, e a cópia segura já feita.'
    : 'Ordem tentada: o link do app (indisponível por aqui), depois a cópia segura.';
}

export class IrSection {
  readonly el: HTMLElement;
  private id = '';
  private req = 0;
  private btn: HTMLButtonElement;
  private links: HTMLElement;
  private info: HTMLElement;
  private order: HTMLElement;
  private fallback: HTMLElement;
  private hint: HTMLElement;

  constructor() {
    this.btn = h('button', { class: 'ui-btn', type: 'button', text: 'Ir para a sessão', on: { click: () => void this.go() } });
    this.links = h('span', { class: 'ui-status__actions' });
    this.info = h('p', { class: 'ui-small', role: 'status', hidden: true });
    this.order = h('p', { class: 'ui-muted ui-small', hidden: true });
    this.hint = h('p', { class: 'ui-muted ui-small', hidden: true });
    this.fallback = h('code', { class: 'ui-mono', hidden: true });
    this.el = h(
      'div',
      {},
      h('div', { class: 'ui-status__actions' }, this.btn, this.links),
      this.info,
      this.hint,
      this.order,
      this.fallback,
    );
  }

  /** Troca o agente: o resultado do clique anterior some junto. */
  setAgent(id: string): void {
    if (id === this.id) return;
    this.id = id;
    this.req++;
    this.links.replaceChildren();
    for (const el of [this.info, this.order, this.fallback, this.hint]) setHidden(el, true);
  }

  private async go(): Promise<void> {
    const id = this.id;
    const req = ++this.req;
    let ir: IrInfo;
    try {
      const res = await fetch(`/api/agentes/${encodeURIComponent(id)}/ir`);
      if (!res.ok) throw new Error(String(res.status));
      ir = (await res.json()) as IrInfo;
    } catch {
      if (req === this.req) this.show('Não foi possível obter o comando desta sessão.', '');
      return;
    }
    if (req !== this.req) return;
    this.links.replaceChildren(
      ...ir.links.map((l) => h('a', { class: 'ui-btn', text: l.rotulo, attrs: { href: l.href }, on: ehLinkDaSessao(l.href) ? { click: () => this.esperarApp(req) } : {} })),
    );
    setText(this.hint, AVISO_ATALHOS);
    setHidden(this.hint, !ir.links.some((l) => ehLinkDaSessao(l.href)));
    const ok = await copyText(ir.comando);
    if (req !== this.req) return;
    this.show(ok ? copiadoTexto(ir) : `Não foi possível copiar. Selecione e copie${ir.aviso ? ` (${ir.aviso})` : ''}:`, ordemTentada(ir));
    setHidden(this.fallback, ok);
    if (ok) return;
    setText(this.fallback, ir.comando);
    const range = document.createRange();
    range.selectNodeContents(this.fallback);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  private esperarApp(req: number): void {
    setTimeout(() => {
      if (req !== this.req || appRespondeu({ temFoco: document.hasFocus(), visivel: document.visibilityState === 'visible' })) return;
      this.show(AVISO_SEM_RESPOSTA, '');
    }, ESPERA_APP_MS);
  }

  private show(info: string, order: string): void {
    setText(this.info, info);
    setHidden(this.info, false);
    setText(this.order, order);
    setHidden(this.order, !order);
    setHidden(this.fallback, true);
  }
}
