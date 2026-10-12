// "Ir para a sessão": pede o comando seguro ao servidor no clique e o copia direto para a área de transferência.
// O comando só aparece na tela se a cópia for recusada, já selecionado. Em terminal viva, o clique antes pede ao
// mod do Claude Code que traga o painel da sessão à frente e só cai na cópia se isso não der certo.
import { ESPERA_ASSUMIR_MS } from '../../../shared/foco';
import type { IrInfo } from '../../../shared/types';
import { tokenLocal } from '../net/token';
import { copyText, h, setHidden, setText } from './dom';

export function copiadoTexto(ir: Pick<IrInfo, 'aviso'>): string {
  return ir.aviso ? `Comando copiado: ${ir.aviso}.` : 'Comando copiado.';
}

const LINK_DA_SESSAO = /^claude:\/\/code\/continue\?session=local_[A-Za-z0-9-]{1,64}$/;
const ESPERA_APP_MS = 2000;
const AVISO_ATALHOS =
  'Se o app não vier à frente, ele ignora links externos (conta desconectada ou links claude:// bloqueados por política). Use o comando copiado.';
const AVISO_SEM_RESPOSTA = 'O app não respondeu em 2 s: os atalhos externos dele podem estar desligados. Use o comando copiado.';

export const ROTULO_IR = 'Ir para a sessão';
export const ROTULO_FOCAR = 'Focar a sessão';
const ESPERA_RESULTADO_MS = 12_000;
const INTERVALO_MS = 250;
const MOTIVOS: Record<string, string> = {
  'sem-painel': 'não achei o painel dessa sessão',
  'nao-e-claude': 'esse processo não é mais o Claude Code',
  vencido: 'o pedido venceu antes de alguém executá-lo',
};
export const SEM_MOD = 'Nenhuma sessão do Claude Code com o Expediente aberta para focar.';

export type DesfechoFoco = { tipo: 'focado' } | { tipo: 'motivo'; texto: string } | { tipo: 'ninguem' };

export interface FocoDeps {
  post(url: string, corpo: unknown): Promise<{ ok: boolean; json: unknown }>;
  get(url: string): Promise<{ ok: boolean; json: unknown }>;
  /** O navegador desistiu do pedido: o servidor o descarta se ninguém assumiu. */
  apagar(url: string): Promise<unknown>;
  esperar(ms: number): Promise<void>;
  agora(): number;
  /** Falso quando o clique já foi superado por outro agente ou outro clique. */
  vale(): boolean;
}

function campo(v: unknown, nome: string): unknown {
  return v && typeof v === 'object' ? (v as Record<string, unknown>)[nome] : undefined;
}

async function desistir(io: FocoDeps, token: string): Promise<DesfechoFoco> {
  await io.apagar(`/api/focos/${token}`);
  return { tipo: 'ninguem' };
}

/** Pede o foco e acompanha o pedido: 3 s para alguém assumir, depois mais tempo para o resultado. */
export async function focarSessao(io: FocoDeps, id: string, nonce: string): Promise<DesfechoFoco> {
  const pedido = await io.post(`/api/agentes/${encodeURIComponent(id)}/focar`, { n: nonce });
  const token = campo(pedido.json, 'token');
  if (!pedido.ok || typeof token !== 'string') return { tipo: 'motivo', texto: 'o Expediente recusou o pedido' };
  const inicio = io.agora();
  for (;;) {
    await io.esperar(INTERVALO_MS);
    if (!io.vale()) return desistir(io, token);
    const r = await io.get(`/api/focos/${token}`);
    const estado = r.ok ? campo(r.json, 'estado') : undefined;
    if (estado === 'focado') return { tipo: 'focado' };
    if (typeof estado === 'string' && MOTIVOS[estado]) return { tipo: 'motivo', texto: MOTIVOS[estado] };
    const gasto = io.agora() - inicio;
    if (estado === 'assumido' ? gasto > ESPERA_RESULTADO_MS : gasto > ESPERA_ASSUMIR_MS) return estado === 'assumido' ? { tipo: 'motivo', texto: 'a sessão não respondeu' } : desistir(io, token);
  }
}

export interface CliqueDeps {
  foco: FocoDeps;
  emFoco(): void;
  copiar(texto: string): Promise<boolean>;
  vale(): boolean;
}

/** O que o clique em "Ir para a sessão" decide: tenta o foco quando o servidor oferece, senão (ou se falhar) copia o comando. */
export async function cliqueNaSessao(ir: IrInfo, id: string, io: CliqueDeps): Promise<{ info: string; ordem: string; copiou: boolean } | undefined> {
  let aviso = '';
  if (ir.focar && ir.nonce) {
    io.emFoco();
    const desfecho = await focarSessao(io.foco, id, ir.nonce);
    if (!io.vale()) return undefined;
    if (desfecho.tipo === 'focado') return { info: 'Sessão em foco.', ordem: '', copiou: true };
    aviso = `${desfecho.tipo === 'ninguem' ? SEM_MOD : `Não deu para focar: ${desfecho.texto}.`} `;
  }
  const copiou = await io.copiar(ir.comando);
  if (!io.vale()) return undefined;
  const texto = copiou ? copiadoTexto(ir) : `Não foi possível copiar. Selecione e copie${ir.aviso ? ` (${ir.aviso})` : ''}:`;
  return { info: aviso + texto, ordem: ordemTentada(ir), copiou };
}

/** Terminal viva: onde o botão pede o foco do painel em vez de só copiar o comando. */
export function focavelNaGaveta(a: { origin?: string; status: string }): boolean {
  return a.origin === 'terminal' && a.status !== 'offline';
}

export function ehLinkDaSessao(href: string): boolean {
  return LINK_DA_SESSAO.test(href);
}

/** Quando o app assume o primeiro plano, a página perde o foco ou fica oculta. */
export function appRespondeu(estado: { temFoco: boolean; visivel: boolean }): boolean {
  return !estado.temFoco || !estado.visivel;
}

export function ordemTentada(ir: Pick<IrInfo, 'origin' | 'links'>): string {
  if (ir.origin !== 'app desktop') return 'Ordem tentada: a cópia segura do comando e, ao lado, o botão que abre uma nova sessão neste projeto.';
  return ir.links.some((l) => ehLinkDaSessao(l.href))
    ? 'Ordem tentada: o link da sessão no app, ao lado, e a cópia segura já feita.'
    : 'Ordem tentada: o link do app (indisponível por aqui), depois a cópia segura.';
}

export class IrSection {
  readonly el: HTMLElement;
  private id = '';
  private focavel = false;
  private req = 0;
  private btn: HTMLButtonElement;
  private links: HTMLElement;
  private info: HTMLElement;
  private order: HTMLElement;
  private fallback: HTMLElement;
  private hint: HTMLElement;

  constructor() {
    this.btn = h('button', { class: 'ui-btn', type: 'button', text: ROTULO_IR, on: { click: () => void this.go() } });
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

  /** `focavel`: ver `focavelNaGaveta`. */
  setAgent(id: string, focavel: boolean): void {
    if (focavel !== this.focavel) {
      this.focavel = focavel;
      setText(this.btn, focavel ? ROTULO_FOCAR : ROTULO_IR);
    }
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
    const r = await cliqueNaSessao(ir, id, {
      foco: this.focoDeps(req),
      emFoco: () => this.show('Focando…', ''),
      copiar: copyText,
      vale: () => req === this.req,
    });
    if (!r) return;
    this.show(r.info, r.ordem);
    setHidden(this.fallback, r.copiou);
    if (r.copiou) return;
    setText(this.fallback, ir.comando);
    const range = document.createRange();
    range.selectNodeContents(this.fallback);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  private focoDeps(req: number): FocoDeps {
    const chamar = async (url: string, init?: RequestInit) => {
      try {
        const res = await (init?.method ? tokenLocal.escrever(url, init) : fetch(url, init));
        return { ok: res.ok, json: (await res.json().catch(() => undefined)) as unknown };
      } catch {
        return { ok: false, json: undefined };
      }
    };
    return {
      post: (url, corpo) => chamar(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(corpo) }),
      get: (url) => chamar(url),
      apagar: (url) => chamar(url, { method: 'DELETE', headers: { 'content-type': 'application/json' } }),
      esperar: (ms) => new Promise((ok) => setTimeout(ok, ms)),
      agora: Date.now,
      vale: () => req === this.req,
    };
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
