// Avisos rápidos (toasts) no canto inferior direito da área livre (acima do feed, à esquerda da gaveta).
import { linkListaDeEspera, textoPrecisamDeVoce } from '../../../shared/espera';
import type { Notice, NoticeLevel } from '../../../shared/types';
import { createAvatar } from './avatar';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, prefersReducedMotion, setHidden, setText } from './dom';
import { deveAgrupar, nomesDeQuemEspera } from './espera-aviso';
import { ICONS } from './icons';
import { waitingAgents } from './model';
import { focusPermission } from './permission';

const MAX_VISIBLE = 4;
/** Avisos iguais dentro desta janela viram um só (com contador). */
const DEDUPE_MS = 20_000;
const LIFETIME: Record<NoticeLevel, number> = { info: 5_000, success: 6_000, warn: 9_000, alert: Infinity };

interface Toast {
  key: string;
  notice: Notice;
  el: HTMLElement;
  count: HTMLElement;
  /** "Responder" (alertas de quem tem pedido de permissão para responder pelo escritório). */
  answer?: HTMLButtonElement;
  repeats: number;
  timer: ReturnType<typeof setTimeout> | null;
  remaining: number;
  startedAt: number;
}

interface Grupo {
  el: HTMLElement;
  texto: HTMLElement;
  nomes: HTMLElement;
  responder: HTMLButtonElement;
  app: HTMLAnchorElement;
  /** Quem o "Responder" atende agora: quem espera há mais tempo e tem pedido. */
  alvo: string | null;
}

export class Toasts implements UiComponent {
  readonly el: HTMLElement;
  private toasts: Toast[] = [];
  private grupo: Grupo | null = null;

  constructor(private ctx: UiContext) {
    this.el = h('div', { class: 'ui-toasts', attrs: { 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'Avisos' } });
    ctx.store.on('notice', (n) => this.push(n));
  }

  push(n: Notice): void {
    // Contas ocultas no filtro da barra lateral não geram avisos, exceto "precisa de você" (exige ação).
    if (n.level !== 'alert' && n.agentId) {
      const acc = this.ctx.agent(n.agentId)?.account;
      if (acc && this.ctx.prefs.hiddenAccounts.includes(acc)) return;
    }
    const key = `${n.level}|${n.agentId ?? ''}|${n.text}`;
    const dup = this.toasts.find((t) => t.key === key && n.at - t.notice.at < DEDUPE_MS);
    if (dup) {
      dup.repeats++;
      dup.notice = n;
      setText(dup.count, `×${dup.repeats}`);
      setHidden(dup.count, false);
      dup.el.classList.remove('is-bump');
      void dup.el.offsetWidth;
      dup.el.classList.add('is-bump');
      this.arm(dup, LIFETIME[n.level]);
      return;
    }
    // Um novo alerta do mesmo agente substitui o anterior.
    if (n.level === 'alert' && n.agentId) this.toasts.filter((t) => t.notice.level === 'alert' && t.notice.agentId === n.agentId).forEach((t) => this.dismiss(t));

    const toast = this.create(n, key);
    this.toasts.push(toast);
    this.el.prepend(toast.el);
    this.arm(toast, LIFETIME[n.level]);
    // Alertas não são expulsos por outros avisos: cada um some quando o agente deixa de esperar.
    const comuns = this.toasts.filter((t) => t.notice.level !== 'alert');
    for (const victim of comuns.slice(0, Math.max(0, comuns.length - MAX_VISIBLE))) this.dismiss(victim);
  }

  /** Alertas somem quando o agente deixa de esperar (ou sai do escritório). */
  render(): void {
    for (const t of [...this.toasts]) {
      if (t.notice.level !== 'alert' || !t.notice.agentId) continue;
      const a = this.ctx.agent(t.notice.agentId);
      if (!a || a.status !== 'waiting') this.dismiss(t);
      // O pedido pode chegar (pelo hook) depois do aviso: o atalho aparece quando ele existe.
      else if (t.answer) setHidden(t.answer, !a.permission);
    }
    this.renderGrupo();
  }

  private alertas(): Toast[] {
    return this.toasts.filter((t) => t.notice.level === 'alert' && t.notice.agentId);
  }

  /** Com dois ou mais alertas, os avisos individuais se escondem atrás de um só, com a contagem. */
  private renderGrupo(): void {
    const alertas = this.alertas();
    const agrupar = deveAgrupar(alertas.length);
    for (const t of alertas) t.el.classList.toggle('is-agrupado', agrupar);
    if (!agrupar) {
      if (this.grupo) {
        this.grupo.el.remove();
        this.grupo = null;
      }
      return;
    }
    const g = (this.grupo ??= this.createGrupo());
    if (!g.el.isConnected) this.el.prepend(g.el);
    const agents = this.ctx.store.snapshot?.agents ?? [];
    const esperando = waitingAgents(agents);
    setText(g.texto, textoPrecisamDeVoce(esperando.length));
    setText(g.nomes, nomesDeQuemEspera(esperando.map((a) => a.name)));
    g.alvo = esperando.find((a) => a.permission)?.id ?? null;
    setHidden(g.responder, !g.alvo);
    const link = linkListaDeEspera(agents);
    setHidden(g.app, !link);
    if (link) g.app.href = link;
  }

  private createGrupo(): Grupo {
    const texto = h('span', { class: 'ui-toast__text' });
    const nomes = h('span', { class: 'ui-toast__nomes' });
    const body = h('button', { class: 'ui-toast__body', type: 'button', title: 'Mostrar quem espera na lista' }, h('span', { text: '✋' }), texto, nomes);
    body.addEventListener('click', () => this.ctx.showWaiting());
    const responder = h('button', { class: 'ui-toast__answer', type: 'button', text: 'Responder', title: 'Responder pelo escritório a quem espera há mais tempo' });
    const app = h('a', { class: 'ui-toast__answer', text: 'Lista no app', title: 'Abre, no app do Claude, a lista de sessões que esperam você', hidden: true });
    app.rel = 'noopener';
    const acoes = h('div', { class: 'ui-toast__acoes' }, responder, app);
    const el = h('div', { class: 'ui-toast ui-toast--alert ui-toast--grupo', role: 'alert' }, body, iconButton(ICONS.close, 'Fechar aviso', () => this.alertas().forEach((t) => this.dismiss(t)), 'ui-icon-btn--sm ui-toast__close'), acoes);
    const g: Grupo = { el, texto, nomes, responder, app, alvo: null };
    responder.addEventListener('click', () => g.alvo && focusPermission(this.ctx, g.alvo));
    return g;
  }

  private create(n: Notice, key: string): Toast {
    const agent = n.agentId ? this.ctx.agent(n.agentId) : undefined;
    const count = h('span', { class: 'ui-toast__count', hidden: true });
    const body = h(
      'button',
      { class: 'ui-toast__body', type: 'button', title: n.agentId || n.roomId ? 'Mostrar no escritório' : '' },
      agent ? createAvatar(agent, 'xs') : null,
      h('span', { class: 'ui-toast__text', text: n.text }),
      count,
    );
    body.addEventListener('click', () => {
      if (n.agentId && this.ctx.agent(n.agentId)) this.ctx.select({ type: 'agent', id: n.agentId }, { focus: true });
      else if (n.roomId && this.ctx.store.room(n.roomId)) this.ctx.select({ type: 'room', id: n.roomId }, { focus: true });
    });
    const el = h('div', { class: `ui-toast ui-toast--${n.level}`, role: n.level === 'alert' ? 'alert' : 'status' }, body);
    const toast: Toast = { key, notice: n, el, count, repeats: 1, timer: null, remaining: 0, startedAt: 0 };
    if (n.level === 'alert' && n.agentId) {
      const id = n.agentId;
      toast.answer = h('button', { class: 'ui-toast__answer', type: 'button', text: 'Responder', title: 'Responder pelo escritório (aprovar, recusar ou responder a pergunta)', hidden: !agent?.permission, on: { click: () => focusPermission(this.ctx, id) } });
      el.append(toast.answer);
    }
    el.append(iconButton(ICONS.close, 'Fechar aviso', () => this.dismiss(toast), 'ui-icon-btn--sm ui-toast__close'));
    // Pausa o tempo de vida com o mouse em cima.
    el.addEventListener('mouseenter', () => this.pause(toast));
    el.addEventListener('mouseleave', () => this.arm(toast, toast.remaining));
    return toast;
  }

  private arm(t: Toast, ms: number): void {
    if (t.timer) clearTimeout(t.timer);
    t.timer = null;
    t.remaining = ms;
    if (!Number.isFinite(ms)) return;
    t.startedAt = Date.now();
    t.timer = setTimeout(() => this.dismiss(t), ms);
  }

  private pause(t: Toast): void {
    if (!t.timer) return;
    clearTimeout(t.timer);
    t.timer = null;
    t.remaining = Math.max(1_500, t.remaining - (Date.now() - t.startedAt));
  }

  private dismiss(t: Toast): void {
    const i = this.toasts.indexOf(t);
    if (i < 0) return;
    this.toasts.splice(i, 1);
    if (t.timer) clearTimeout(t.timer);
    t.el.classList.add('is-leaving');
    const done = () => t.el.remove();
    if (typeof t.el.animate !== 'function' || prefersReducedMotion()) return done();
    const anim = t.el.animate(
      [
        { opacity: 1, transform: 'translateX(0)', height: `${t.el.offsetHeight}px` },
        { opacity: 0, transform: 'translateX(24px)', height: `${t.el.offsetHeight}px`, offset: 0.6 },
        { opacity: 0, transform: 'translateX(24px)', height: '0px', marginBottom: '0px' },
      ],
      { duration: 280, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' },
    );
    anim.onfinish = done;
  }
}
