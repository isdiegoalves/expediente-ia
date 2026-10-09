// Versão do Expediente: o número na barra superior e a seção "Sobre" das configurações.
import type { OfficeSnapshot } from '../../../shared/types';
import type { UiComponent, UiContext } from './context';
import { h, setHidden, setText, setTitle } from './dom';

/** Versão em uso, do snapshot ao vivo (no timelapse e no ?mock=1 não há versão real). */
export function versionInfo(snap: OfficeSnapshot | null | undefined): { version: string } | null {
  const v = snap?.meta.version;
  if (!v || !/^\d+\.\d+\.\d+/.test(v)) return null;
  return { version: v };
}

/** Número da versão na barra superior; o clique leva à seção "Sobre". */
export class VersionChip implements UiComponent {
  readonly el: HTMLButtonElement;
  private text: HTMLElement;

  constructor(private ctx: UiContext) {
    this.text = h('span', { class: 'ui-version__text' });
    this.el = h('button', { class: 'ui-version', type: 'button', hidden: true, on: { click: () => ctx.openAbout() } }, this.text);
  }

  render(): void {
    const info = versionInfo(this.ctx.store.liveSnapshot);
    setHidden(this.el, !info);
    if (!info) return;
    setText(this.text, `v${info.version}`);
    setTitle(this.el, `Expediente v${info.version}. Clique para ver detalhes.`);
  }
}

/** Seção "Sobre" das configurações. */
export class AboutGroup {
  readonly el: HTMLElement;
  private name: HTMLElement;

  constructor(private ctx: UiContext) {
    this.name = h('strong', { class: 'ui-about__version' });
    this.el = h(
      'div',
      { class: 'ui-set-group ui-about', attrs: { id: 'ui-about' } },
      h('h3', { text: 'Sobre', tabIndex: -1 }),
      h('div', { class: 'ui-about__head' }, h('span', { class: 'ui-about__name' }, 'Expediente ', this.name)),
    );
  }

  render(): void {
    const info = versionInfo(this.ctx.store.liveSnapshot);
    setHidden(this.el, !info);
    if (info) setText(this.name, `v${info.version}`);
  }

  /** Rola até a seção e a destaca por um instante (clique no número da versão). */
  highlight(): void {
    this.el.scrollIntoView({ block: 'nearest' });
    this.el.classList.remove('is-highlight');
    void this.el.offsetWidth;
    this.el.classList.add('is-highlight');
  }
}
