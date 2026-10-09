// "Ir para a sessão": pede o comando seguro ao servidor no clique (GET, nenhum POST) e o copia direto para a
// área de transferência. O comando só aparece na tela se a cópia for recusada, já selecionado.
import type { IrInfo } from '../../../shared/types';
import { copyText, h, setHidden, setText } from './dom';

export function copiadoTexto(ir: Pick<IrInfo, 'aviso'>): string {
  return ir.aviso ? `Comando copiado: ${ir.aviso}.` : 'Comando copiado.';
}

export function ordemTentada(ir: Pick<IrInfo, 'origin'>): string {
  return ir.origin === 'app desktop'
    ? 'Ordem tentada: o link do app (indisponível por aqui), depois a cópia segura.'
    : 'Ordem tentada: a cópia segura do comando e, ao lado, o botão que abre o projeto.';
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

  constructor() {
    this.btn = h('button', { class: 'ui-btn', type: 'button', text: 'Ir para a sessão', on: { click: () => void this.go() } });
    this.links = h('span', { class: 'ui-status__actions' });
    this.info = h('p', { class: 'ui-small', role: 'status', hidden: true });
    this.order = h('p', { class: 'ui-muted ui-small', hidden: true });
    this.fallback = h('code', { class: 'ui-mono', hidden: true });
    this.el = h(
      'div',
      {},
      h('div', { class: 'ui-status__actions' }, this.btn, this.links),
      this.info,
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
    for (const el of [this.info, this.order, this.fallback]) setHidden(el, true);
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
    this.links.replaceChildren(...ir.links.map((l) => h('a', { class: 'ui-btn', text: l.rotulo, attrs: { href: l.href } })));
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

  private show(info: string, order: string): void {
    setText(this.info, info);
    setHidden(this.info, false);
    setText(this.order, order);
    setHidden(this.order, !order);
    setHidden(this.fallback, true);
  }
}
