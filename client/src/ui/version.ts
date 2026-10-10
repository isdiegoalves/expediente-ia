// Versão do Expediente: o número na barra superior e a seção "Sobre" das configurações.
import type { OfficeSnapshot } from '../../../shared/types';
import type { VersaoView } from '../../../shared/versao';
import { tema } from '../tema';
import type { UiComponent, UiContext } from './context';
import { h, setHidden, setText, setTitle } from './dom';
import { relativeTime } from './format';

/** Versão em uso, do snapshot ao vivo (no timelapse e no ?mock=1 não há versão real). */
export function versionInfo(snap: OfficeSnapshot | null | undefined): { version: string } | null {
  const v = snap?.meta.version;
  if (!v || !/^\d+\.\d+\.\d+/.test(v)) return null;
  return { version: v };
}

/** A versão em uso: a do snapshot ao vivo ou, sem ela (?mock=1), a que o servidor informou. */
function emUso(ctx: UiContext): string | null {
  return versionInfo(ctx.store.liveSnapshot)?.version ?? ctx.versao.view?.emUso ?? null;
}

/** Só há versão nova quando o servidor achou a última maior que a em uso. */
export function versaoNova(view: VersaoView | null | undefined): { versao: string; publicadaEm: string; url: string } | null {
  return view?.nova && view.ultima ? view.ultima : null;
}

/** A versão nova que ainda não foi avisada (um aviso por versão); null quando não há o que avisar. */
export function versaoParaAvisar(view: VersaoView | null | undefined, avisada: string | null): string | null {
  const nova = versaoNova(view);
  return nova && nova.versao !== avisada ? nova.versao : null;
}

export interface SobreModelo {
  nova: { versao: string; quando: string; url: string } | null;
  verificacao: { texto: string; comando?: string };
  origem: { texto: string; analise?: string } | null;
}

export function sobreModelo(view: VersaoView | null | undefined, agora: number): SobreModelo {
  const nova = versaoNova(view);
  const verificadoEm = view?.verificadoEm ? Date.parse(view.verificadoEm) : NaN;
  return {
    nova: nova ? { versao: nova.versao, quando: new Date(nova.publicadaEm).toLocaleDateString('pt-BR'), url: nova.url } : null,
    verificacao: Number.isNaN(verificadoEm) ? { texto: 'Nunca verificado: rode', comando: 'npm run versao' } : { texto: `Última verificação: ${relativeTime(verificadoEm, agora)}` },
    origem: view?.origem ? { texto: `Novidade no projeto de origem: ${view.origem.nome} ${view.origem.ultima}`, analise: view.origem.analise } : null,
  };
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
    const version = emUso(this.ctx);
    setHidden(this.el, !version);
    if (!version) return;
    const nova = versaoNova(this.ctx.versao.view);
    this.el.classList.toggle('ui-version--nova', !!nova);
    setText(this.text, nova ? 'Nova versão' : `v${version}`);
    setTitle(this.el, nova ? `${tema().textos.produto} v${nova.versao} disponível (em uso: v${version}). Clique para ver detalhes.` : `${tema().textos.produto} v${version}. Clique para ver detalhes.`);
  }
}

/** Seção "Sobre" das configurações. */
export class AboutGroup {
  readonly el: HTMLElement;
  private name: HTMLElement;
  private novaLinha: HTMLElement;
  private novaTexto: HTMLElement;
  private novaLink: HTMLAnchorElement;
  private verificacao: HTMLElement;
  private verificacaoTexto: HTMLElement;
  private verificacaoComando: HTMLElement;
  private origem: HTMLElement;
  private origemTexto: HTMLElement;
  private origemLink: HTMLAnchorElement;

  constructor(private ctx: UiContext) {
    const link = (texto: string) => h('a', { class: 'ui-about__link', text: texto, attrs: { target: '_blank', rel: 'noopener noreferrer' } });
    const code = (texto: string) => h('code', { text: texto });
    this.name = h('strong', { class: 'ui-about__version' });
    this.novaTexto = h('span');
    this.novaLink = link('Ver o que mudou');
    this.novaLinha = h(
      'div',
      { class: 'ui-about__nova', hidden: true },
      h('div', { class: 'ui-about__novatexto' }, this.novaTexto, ' ', this.novaLink),
      h('div', { class: 'ui-set__hint' }, 'Para atualizar: ', code('git pull'), ', ', code('npm run docker:up'), ' e ', code('npm run instalar'), '.'),
    );
    this.verificacaoTexto = h('span');
    this.verificacaoComando = code('');
    this.verificacao = h('div', { class: 'ui-set__hint' }, this.verificacaoTexto, ' ', this.verificacaoComando);
    this.origemTexto = h('span');
    this.origemLink = link('Ver análise');
    this.origem = h('div', { class: 'ui-set__hint', hidden: true }, this.origemTexto, ' ', this.origemLink);
    this.el = h(
      'div',
      { class: 'ui-set-group ui-about', attrs: { id: 'ui-about' } },
      h('h3', { text: 'Sobre', tabIndex: -1 }),
      h('div', { class: 'ui-about__head' }, h('span', { class: 'ui-about__name' }, `${tema().textos.produto} `, this.name)),
      this.novaLinha,
      this.verificacao,
      this.origem,
    );
  }

  render(): void {
    const version = emUso(this.ctx);
    setHidden(this.el, !version);
    if (!version) return;
    setText(this.name, `v${version}`);
    const m = sobreModelo(this.ctx.versao.view, this.ctx.now());
    setHidden(this.novaLinha, !m.nova);
    if (m.nova) {
      setText(this.novaTexto, `Nova versão disponível: v${m.nova.versao}, publicada em ${m.nova.quando}.`);
      this.novaLink.href = m.nova.url;
    }
    setText(this.verificacaoTexto, m.verificacao.texto);
    setText(this.verificacaoComando, m.verificacao.comando ?? '');
    setHidden(this.verificacaoComando, !m.verificacao.comando);
    setHidden(this.origem, !m.origem);
    if (m.origem) {
      setText(this.origemTexto, m.origem.texto);
      setHidden(this.origemLink, !m.origem.analise);
      if (m.origem.analise) this.origemLink.href = m.origem.analise;
    }
  }

  /** Rola até a seção e a destaca por um instante (clique no número da versão). */
  highlight(): void {
    this.el.scrollIntoView({ block: 'nearest' });
    this.el.classList.remove('is-highlight');
    void this.el.offsetWidth;
    this.el.classList.add('is-highlight');
  }
}
