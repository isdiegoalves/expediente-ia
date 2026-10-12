// Aviso das ações bloqueadas: a página sem o token local (ou o servidor sem token) lê tudo, mas não muda nada.
import { tokenLocal } from '../net/token';
import type { UiComponent, UiContext } from './context';
import { h, setHidden, setText } from './dom';

export interface EstadoDoToken {
  /** `?mock=1`: não há servidor, nada é escrito. */
  mock: boolean;
  /** A leitura da chave guardada e a troca do bilhete da URL já terminaram. */
  carregado: boolean;
  /** Esta página tem a chave do token. */
  paginaTemToken: boolean;
  /** O endereço em que a página foi aberta (`host:porta`). A chave vale só na origem http://127.0.0.1:<porta>. */
  endereco: string;
  /** O motivo que o /api/health deu para o servidor estar sem token; null = o servidor tem. */
  servidorSemToken: string | null;
}

const PASSOS_DA_PAGINA = [
  'As ações que mudam algo (responder permissões, renomear salas, mudar o personagem ou o ritmo, focar sessões) estão bloqueadas: esta página não tem o token local. O que é só leitura segue funcionando.',
  'Para liberar:',
  '1. No Claude Code, rode /escritorio e use "Abrir o escritório"; ou, na pasta do Expediente, rode npm run abrir',
  '2. A página abre já autorizada (por http://127.0.0.1, o endereço em que a autorização vale).',
].join('\n');

/** O texto do aviso, ou null quando não há o que avisar. */
export function textoDoAviso(e: EstadoDoToken): string | null {
  if (e.mock || !e.carregado) return null;
  if (e.servidorSemToken !== null) {
    return [
      `O servidor está sem token local (${e.servidorSemToken}), então as ações que mudam algo estão bloqueadas.`,
      'Para liberar:',
      '1. Na pasta do Expediente, rode npm run docker:up (no modo nativo, reinicie o servidor: ele cria o token se faltar).',
      '2. Abra o escritório de novo com npm run abrir',
    ].join('\n');
  }
  if (e.paginaTemToken) return null;
  return e.endereco.startsWith('127.0.0.1:') ? PASSOS_DA_PAGINA : `${PASSOS_DA_PAGINA}\nVocê abriu por ${e.endereco}. A autorização vale só na origem http://127.0.0.1:<porta>: o que o npm run abrir abre. Por aqui dá para ler tudo, mas não mudar nada.`;
}

async function motivoDoServidor(): Promise<string | null> {
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    if (!res.ok) return null;
    const token = ((await res.json()) as { token?: { ok?: unknown; motivo?: unknown } }).token;
    return token && token.ok === false ? (typeof token.motivo === 'string' ? token.motivo : 'sem motivo') : null;
  } catch {
    return null;
  }
}

export class TokenAviso implements UiComponent {
  readonly el: HTMLElement;
  private texto: HTMLElement;
  private servidorSemToken: string | null = null;
  private dispensado = false;

  constructor(private ctx: UiContext) {
    this.texto = h('span', { class: 'ui-banner__text ui-banner__text--passos' });
    const entendi = h('button', {
      class: 'ui-btn ui-btn--sm',
      type: 'button',
      text: 'Entendi',
      on: {
        click: () => {
          this.dispensado = true;
          ctx.invalidate();
        },
      },
    });
    this.el = h('div', { class: 'ui-banner ui-banner--token', role: 'status', hidden: true }, h('span', { class: 'ui-banner__dot', attrs: { 'aria-hidden': 'true' } }), this.texto, entendi);
    // Token que entra ou sai (fragmento da URL, 401 do servidor) volta a avisar mesmo depois do "Entendi".
    tokenLocal.aoMudar(() => {
      this.dispensado = false;
      ctx.invalidate();
    });
    if (!ctx.store.mock) {
      void motivoDoServidor().then((motivo) => {
        this.servidorSemToken = motivo;
        ctx.invalidate();
      });
    }
  }

  render(): void {
    const texto = this.dispensado ? null : textoDoAviso({ mock: this.ctx.store.mock, carregado: tokenLocal.carregado, paginaTemToken: tokenLocal.tem(), endereco: location.host, servidorSemToken: this.servidorSemToken });
    setHidden(this.el, texto === null);
    if (texto !== null) setText(this.texto, texto);
  }
}
