// Barra lateral: busca, filtro por conta e a lista de salas -> agentes -> subagentes.
import type { AccountInfo, AgentInfo } from '../../../shared/types';
import { textoPrecisamDeVoce } from '../../../shared/espera';
import { roomTheme } from '../art';
import type { UiComponent, UiContext } from './context';
import { createGrupoHead, itemKey, itensDeSubs, updateGrupoHead, type ItemSubs } from './equipes';
import { moveAgent, orderAgents } from './agentorder';
import { moveRoom, orderRooms } from './roomorder';
import { h, iconButton, KeyedList, setAttr, setHidden, setStyleVar, setText, setTitle } from './dom';
import { plural, shortPath } from './format';
import { ICONS } from './icons';
import { groupRooms, type AgentNode, type RoomGroup } from './model';
import { officeIsEmpty } from './overlays';
import { salasRecolhidas, alternarSala } from './recolhidas';
import { assinaturaDaLinha, createAgentRow, updateAgentRow } from './rows';
import { contarPorStatus, esperamNoNo, STATUS_FILTROS, subirQuemEspera, type StatusFiltro } from './urgencia';
import { createAccountChip, createProgress, updateAccountChip, updateProgress } from './widgets';

interface RoomRefs {
  head: HTMLButtonElement;
  name: HTMLElement;
  count: HTMLElement;
  espera: HTMLElement;
  fold: HTMLButtonElement;
  path: HTMLElement;
  accs: KeyedList<AccountInfo | string>;
  tasks: HTMLElement;
  tasksBar: HTMLElement;
  tasksText: HTMLElement;
  nodes: KeyedList<AgentNode>;
  /** Assinatura da última atualização: igual na próxima, a sala já está certa. */
  sig?: string;
}

interface NodeRefs {
  row: HTMLButtonElement;
  /** Linha do agente: arrastável para reordenar os agentes da sala. */
  head: HTMLElement;
  subsWrap: HTMLElement;
  subsCaption: HTMLElement;
  subs: KeyedList<ItemSubs>;
  sig?: string;
}

export class Sidebar implements UiComponent {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private query = '';
  private filters: HTMLElement;
  private statusBar: HTMLElement;
  private statusBtns = new Map<StatusFiltro, HTMLButtonElement>();
  private status: StatusFiltro = 'todos';
  private filterList: KeyedList<AccountInfo, HTMLButtonElement>;
  private scroller: HTMLElement;
  private rooms: KeyedList<RoomGroup>;
  private roomRefs = new WeakMap<HTMLElement, RoomRefs>();
  private nodeRefs = new WeakMap<HTMLElement, NodeRefs>();
  /** Agentes de cada sala na ordem mostrada (para arrastar e soltar). */
  private shown = new Map<string, AgentNode[]>();
  private dragging: { id: string; room: string } | null = null;
  /** Sala sendo arrastada (reordenar as salas) e a ordem mostrada agora. */
  private draggingRoom: string | null = null;
  private shownRooms: string[] = [];
  private empty: HTMLElement;
  private emptyText: HTMLElement;
  private clearBtn: HTMLButtonElement;
  private lastSelKey = '';
  /** Relógio, agentes e salas recolhidas desta passada de `render`, lidos uma vez só. */
  private agora = 0;
  private agentes: readonly AgentInfo[] = [];
  private recolhidas = new Set<string>();
  /** Os nós são refeitos a cada `render`, então a assinatura de um nó vale só dentro da passada. */
  private assinaturasDosNos = new WeakMap<AgentNode, string>();

  constructor(private ctx: UiContext) {
    this.input = h('input', {
      class: 'ui-search__input',
      type: 'search',
      attrs: { placeholder: 'Buscar agente, projeto ou conta', 'aria-label': 'Buscar agente, projeto ou conta', autocomplete: 'off', spellcheck: 'false' },
    });
    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this.ctx.invalidate();
    });
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (this.input.value) {
          this.input.value = '';
          this.query = '';
          this.ctx.invalidate();
        } else {
          this.input.blur();
        }
      }
    });
    const searchIcon = h('span', { class: 'ui-search__icon', attrs: { 'aria-hidden': 'true' } });
    searchIcon.innerHTML = ICONS.search;
    const search = h('label', { class: 'ui-search' }, searchIcon, this.input, h('kbd', { class: 'ui-kbd', text: '/', title: 'Atalho: /' }));

    this.filters = h('div', { class: 'ui-acc-filters', role: 'group', attrs: { 'aria-label': 'Filtrar por conta' } });
    this.filterList = new KeyedList<AccountInfo, HTMLButtonElement>(this.filters, {
      animate: false,
      key: (a) => a.id,
      create: (a) => {
        const chip = createAccountChip('sm');
        const b = h('button', { class: 'ui-acc-filter', type: 'button' }, chip, h('span', { class: 'ui-acc-filter__name' }));
        b.addEventListener('click', () => this.toggleAccount(a.id));
        return b;
      },
      update: (b, a) => {
        const hidden = this.ctx.prefs.hiddenAccounts.includes(a.id);
        updateAccountChip(b.firstElementChild as HTMLElement, a);
        setText(b.lastElementChild!, a.name);
        setAttr(b, 'aria-pressed', String(!hidden));
        setTitle(b, hidden ? `Mostrar a ${a.name} na lista, no feed e nos avisos` : `Ocultar a ${a.name} na lista, no feed e nos avisos (o escritório continua mostrando todos)`);
        b.classList.toggle('is-off', hidden);
      },
    });

    this.statusBar = h('div', { class: 'ui-status-filters', role: 'group', attrs: { 'aria-label': 'Filtrar por status' } });
    for (const f of STATUS_FILTROS) {
      const b = h('button', { class: 'ui-status-filter', type: 'button', attrs: { 'data-status': f.id } }, h('span', { class: 'ui-status-filter__name', text: f.rotulo }), h('span', { class: 'ui-status-filter__n' }));
      b.addEventListener('click', () => this.setStatus(f.id));
      this.statusBtns.set(f.id, b);
      this.statusBar.append(b);
    }

    this.scroller = h('div', { class: 'ui-side__scroll' });
    const list = h('div', { class: 'ui-rooms', role: 'list', attrs: { 'aria-label': 'Salas' } });
    this.scroller.append(list);
    this.rooms = new KeyedList<RoomGroup>(list, {
      key: (g) => g.room.id,
      create: (g) => this.createRoom(g),
      update: (el, g) => this.updateRoom(el, g),
    });

    this.emptyText = h('p');
    this.clearBtn = h('button', {
      class: 'ui-link-btn',
      type: 'button',
      text: 'Limpar filtros',
      on: {
        click: () => {
          this.input.value = '';
          this.query = '';
          this.status = 'todos';
          this.ctx.updatePrefs({ hiddenAccounts: [] });
          this.ctx.invalidate();
        },
      },
    });
    this.empty = h('div', { class: 'ui-side__empty', hidden: true }, this.emptyText, this.clearBtn);
    this.scroller.append(this.empty);

    const close = iconButton(ICONS.close, 'Fechar painel lateral', () => ctx.togglePanel('sidebar', false), 'ui-side__close');
    this.el = h(
      'aside',
      { class: 'ui-panel ui-sidebar', attrs: { 'aria-label': 'Salas e agentes', id: 'ui-sidebar' } },
      h('div', { class: 'ui-side__head' }, h('div', { class: 'ui-side__title' }, h('h2', { text: 'Escritório' }), close), search, this.filters, this.statusBar),
      this.scroller,
    );
  }

  /** Mostra só um grupo de status (ex.: quem espera você). */
  setStatus(status: StatusFiltro): void {
    this.status = status;
    this.ctx.invalidate();
  }

  focusSearch(): void {
    this.input.focus();
    this.input.select();
  }

  render(): void {
    const snap = this.ctx.store.snapshot;
    this.agora = this.ctx.now();
    this.agentes = snap?.agents ?? [];
    this.recolhidas = salasRecolhidas();
    const accounts = snap?.accounts ?? [];
    const hidden = new Set(this.ctx.prefs.hiddenAccounts);
    this.filterList.sync(accounts.length > 1 ? accounts : []);
    setHidden(this.filters, accounts.length <= 1);

    const counts = contarPorStatus(snap?.agents.filter((a) => a.status !== 'offline') ?? []);
    for (const [id, b] of this.statusBtns) {
      setText(b.lastElementChild!, String(counts[id]));
      setAttr(b, 'aria-pressed', String(this.status === id));
      b.classList.toggle('is-on', this.status === id);
      b.classList.toggle('is-urgent', id === 'esperando' && counts.esperando > 0);
    }

    // Ordem das salas escolhida pelo usuário (arrastando o cabeçalho da sala); quem espera sobe sem mexer nela.
    const manual = orderRooms(groupRooms(snap, { query: this.query, hiddenAccounts: hidden, status: this.status }), (g) => g.room.id);
    this.shownRooms = manual.map((g) => g.room.id);
    const groups = subirQuemEspera(manual, (g) => g.nodes.some((n) => esperamNoNo(n) > 0));
    this.rooms.sync(groups);

    const filtering = this.query.trim().length > 0 || hidden.size > 0 || this.status !== 'todos';
    const total = snap?.agents.length ?? 0;
    // Escritório vazio sem filtro: o cartão central já explica; a lista não repete o aviso.
    const showEmpty = groups.length === 0 && (filtering || !officeIsEmpty(this.ctx));
    setHidden(this.empty, !showEmpty);
    if (showEmpty) {
      setText(
        this.emptyText,
        filtering && total > 0
          ? this.query.trim()
            ? `Nenhum agente encontrado para “${this.query.trim()}”.`
            : this.status !== 'todos'
              ? 'Nenhum agente neste status.'
              : 'Nenhum agente nas contas selecionadas.'
          : 'Nenhuma sessão aberta no momento.',
      );
      setHidden(this.clearBtn, !(filtering && total > 0));
    }

    // Ao mudar a seleção (ex.: clique no canvas), traz o item para a área visível.
    const sel = this.ctx.selection();
    const selKey = sel ? `${sel.type}:${sel.id}` : '';
    if (selKey !== this.lastSelKey) {
      this.lastSelKey = selKey;
      if (sel) {
        const target =
          sel.type === 'agent'
            ? this.el.querySelector<HTMLElement>(`.ui-agent[data-id="${CSS.escape(sel.id)}"]`)
            : this.el.querySelector<HTMLElement>(`.ui-room[data-key="${CSS.escape(sel.id)}"] .ui-room__head`);
        target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }
  }

  private toggleAccount(id: string): void {
    const set = new Set(this.ctx.prefs.hiddenAccounts);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    this.ctx.updatePrefs({ hiddenAccounts: [...set] });
  }

  // ---------------------------------------------------------------- salas

  private createRoom(g: RoomGroup): HTMLElement {
    const name = h('span', { class: 'ui-room__name' });
    const count = h('span', { class: 'ui-room__count' });
    const espera = h('span', { class: 'ui-room__wait', hidden: true });
    const accsEl = h('span', { class: 'ui-room__accs' });
    const path = h('span', { class: 'ui-room__path' });
    const tasksBar = createProgress('Progresso das tarefas da sala');
    const tasksText = h('span', { class: 'ui-room__tasks-text' });
    const tasks = h('span', { class: 'ui-room__tasks' }, tasksBar, tasksText);
    const swatch = h('span', { class: 'ui-room__swatch', attrs: { 'aria-hidden': 'true' } });
    const head = h(
      'button',
      { class: 'ui-room__head', type: 'button' },
      swatch,
      h('span', { class: 'ui-room__line' }, name, count, espera, accsEl),
      path,
      tasks,
    );
    head.addEventListener('click', () => this.ctx.select({ type: 'room', id: g.room.id }, { focus: true }));
    this.wireRoomDrag(head, g.room.id);
    // Botão direito: renomear a sala (ui/roomrename.ts).
    head.addEventListener('contextmenu', (e) => {
      if (!this.ctx.renameRoom) return;
      e.preventDefault();
      const r = head.getBoundingClientRect();
      this.ctx.renameRoom(g.room.id, { x: r.left + 12, y: r.bottom + 4 });
    });
    try {
      setStyleVar(head, '--room', roomTheme(g.room.seed).accent);
    } catch {
      // Sem tema: mantém a cor padrão do CSS.
    }
    const agentsEl = h('ul', { class: 'ui-nodes' });
    const fold = h('button', { class: 'ui-room__fold', type: 'button' });
    fold.innerHTML = ICONS.chevronDown;
    const section = h('section', { class: 'ui-room', role: 'listitem' }, h('div', { class: 'ui-room__bar' }, head, fold), agentsEl);
    fold.addEventListener('click', () => {
      alternarSala(g.room.id);
      this.ctx.invalidate();
    });
    const accs = new KeyedList<AccountInfo | string>(accsEl, {
      animate: false,
      key: (a) => (typeof a === 'string' ? a : a.id),
      create: () => createAccountChip('sm'),
      update: (chip, a) => (typeof a === 'string' ? updateAccountChip(chip, undefined, a) : updateAccountChip(chip, a)),
    });
    const nodes = new KeyedList<AgentNode>(agentsEl, {
      key: (n) => n.agent.id,
      create: (n) => this.createNode(n),
      update: (el, n) => this.updateNode(el, n),
    });
    this.roomRefs.set(section, { head, name, count, espera, fold, path, accs, tasks, tasksBar, tasksText, nodes });
    return section;
  }

  private updateRoom(section: HTMLElement, g: RoomGroup): void {
    const r = this.roomRefs.get(section)!;
    const sel = this.ctx.selection();
    // Ordem escolhida pelo usuário (arrastando as linhas), guardada no navegador.
    const manual = orderAgents(g.room.id, g.nodes, (n) => n.agent.sessionId);
    this.shown.set(g.room.id, manual);
    const nodes = subirQuemEspera(manual, (n) => esperamNoNo(n) > 0);
    const selected = sel?.type === 'room' && sel.id === g.room.id;
    // Com filtro ativo a sala abre: quem filtra quer ver os agentes.
    const recolhida = this.recolhidas.has(g.room.id) && this.query.trim() === '' && this.status === 'todos';
    const present = g.agents.filter((a) => a.status !== 'offline').length;
    const sig = this.assinaturaDaSala(g, nodes, present, selected, recolhida);
    if (r.sig === sig) return;
    r.sig = sig;
    setText(r.name, g.room.name);
    setText(r.count, String(present));
    setTitle(r.count, plural(present, 'agente', 'agentes'));
    setText(r.path, shortPath(g.room.path));
    setTitle(r.head, `${g.room.path}\nClique para ver a sala`);
    setAttr(r.head, 'aria-label', `Sala ${g.room.name}, ${plural(present, 'agente', 'agentes')}`);
    r.accs.sync(g.accounts.map((id) => this.ctx.account(id) ?? id));
    r.head.classList.toggle('is-selected', selected);
    setAttr(r.head, 'aria-current', selected ? 'true' : null);
    section.classList.toggle('is-empty', present === 0);

    const esperando = g.nodes.reduce((n, x) => n + esperamNoNo(x), 0);
    setHidden(r.espera, esperando === 0);
    setText(r.espera, `✋ ${esperando}`);
    setTitle(r.espera, textoPrecisamDeVoce(esperando));
    section.classList.toggle('is-folded', recolhida);
    setAttr(r.fold, 'aria-expanded', String(!recolhida));
    setAttr(r.fold, 'aria-label', `${recolhida ? 'Expandir' : 'Recolher'} a sala ${g.room.name}`);
    setTitle(r.fold, recolhida ? 'Expandir a sala' : 'Recolher a sala');

    const t = g.tasks;
    setHidden(r.tasks, t.total === 0);
    if (t.total > 0) {
      updateProgress(r.tasksBar, t.completed, t.total, t.inProgress);
      setText(r.tasksText, `${t.completed}/${t.total} tarefas`);
    }
    r.nodes.sync(nodes);
  }

  private selecionado(a: AgentInfo): boolean {
    const sel = this.ctx.selection();
    return sel?.type === 'agent' && sel.id === a.id;
  }

  private assinaturaDaLinha(a: AgentInfo, selecionado = this.selecionado(a)): string {
    return assinaturaDaLinha(a, this.ctx.account(a.account), selecionado, this.agora, this.agentes);
  }

  /** O que `updateNode` lê: as linhas, quantos subagentes há e, com grupos, o que o cabeçalho deles usa. */
  private assinaturaDoNo(n: AgentNode): string {
    const feita = this.assinaturasDosNos.get(n);
    if (feita !== undefined) return feita;
    const grupos = n.subs.some((s) => s.teamName || s.rodada !== undefined);
    const partes = [n.subTotal, this.assinaturaDaLinha(n.agent)];
    for (const s of n.subs) {
      partes.push(this.assinaturaDaLinha(s));
      if (grupos) partes.push((s.parentId && this.ctx.agent(s.parentId)?.name) || '');
    }
    if (grupos) partes.push(JSON.stringify(this.ctx.store.snapshot?.equipes ?? []));
    const sig = partes.join('\u0002');
    this.assinaturasDosNos.set(n, sig);
    return sig;
  }

  private assinaturaDaSala(g: RoomGroup, nodes: readonly AgentNode[], present: number, selected: boolean, recolhida: boolean): string {
    const { room, tasks } = g;
    const contas = g.accounts.map((id) => {
      const c = this.ctx.account(id);
      return `${id}:${c?.short}:${c?.color}:${c?.name}:${c?.email}`;
    });
    const cab = [room.id, room.name, room.path, present, selected, recolhida, tasks.completed, tasks.inProgress, tasks.total, ...contas];
    return `${cab.join('\u0001')}\u0003${nodes.map((n) => this.assinaturaDoNo(n)).join('\u0003')}`;
  }

  /** Arrastar o cabeçalho de uma sala reordena as salas da lista. */
  private wireRoomDrag(head: HTMLElement, roomId: string): void {
    head.draggable = true;
    const after = (e: DragEvent) => {
      const rect = head.getBoundingClientRect();
      return e.clientY > rect.top + rect.height / 2;
    };
    const clear = () => {
      for (const el of this.el.querySelectorAll('.ui-room__head.is-drop-before, .ui-room__head.is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
    };
    head.addEventListener('dragstart', (e) => {
      this.draggingRoom = roomId;
      head.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', roomId);
      }
    });
    head.addEventListener('dragend', () => {
      this.draggingRoom = null;
      head.classList.remove('is-dragging');
      clear();
    });
    head.addEventListener('dragover', (e) => {
      const from = this.draggingRoom;
      if (!from || from === roomId) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clear();
      head.classList.add(after(e) ? 'is-drop-after' : 'is-drop-before');
    });
    head.addEventListener('dragleave', () => head.classList.remove('is-drop-before', 'is-drop-after'));
    head.addEventListener('drop', (e) => {
      const from = this.draggingRoom;
      clear();
      if (!from || from === roomId) return;
      e.preventDefault();
      if (moveRoom(this.shownRooms, from, roomId, after(e))) this.ctx.invalidate();
    });
  }

  /** Arrastar a linha de um agente principal reordena os agentes da mesma sala. */
  private wireDrag(head: HTMLElement): void {
    head.draggable = true;
    const id = () => head.dataset.id ?? '';
    const room = () => head.dataset.room ?? '';
    const after = (e: DragEvent) => {
      const rect = head.getBoundingClientRect();
      return e.clientY > rect.top + rect.height / 2;
    };
    const clear = () => {
      for (const el of this.el.querySelectorAll('.ui-node__head.is-drop-before, .ui-node__head.is-drop-after')) el.classList.remove('is-drop-before', 'is-drop-after');
    };
    head.addEventListener('dragstart', (e) => {
      this.dragging = { id: id(), room: room() };
      head.classList.add('is-dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id());
      }
    });
    head.addEventListener('dragend', () => {
      this.dragging = null;
      head.classList.remove('is-dragging');
      clear();
    });
    head.addEventListener('dragover', (e) => {
      const d = this.dragging;
      if (!d || d.room !== room() || d.id === id()) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      clear();
      head.classList.add(after(e) ? 'is-drop-after' : 'is-drop-before');
    });
    head.addEventListener('dragleave', () => head.classList.remove('is-drop-before', 'is-drop-after'));
    head.addEventListener('drop', (e) => {
      const d = this.dragging;
      clear();
      if (!d || d.room !== room() || d.id === id()) return;
      e.preventDefault();
      const shown = this.shown.get(d.room) ?? [];
      if (moveAgent(d.room, shown, (n) => n.agent.id, (n) => n.agent.sessionId, d.id, id(), after(e))) this.ctx.invalidate();
    });
  }

  // ---------------------------------------------------------------- agentes

  private createNode(n: AgentNode): HTMLElement {
    const row = createAgentRow(n.agent, (id) => this.pick(id));
    const subsCaption = h('span', { class: 'ui-subs__caption' });
    const subsList = h('ul', { class: 'ui-subs__list' });
    const subsWrap = h('div', { class: 'ui-subs', hidden: true }, subsCaption, subsList);
    const head = h('div', { class: 'ui-node__head' }, row);
    this.wireDrag(head);
    const li = h('li', { class: 'ui-node' }, head, subsWrap);
    const subs = new KeyedList<ItemSubs>(subsList, {
      key: itemKey,
      create: (i) =>
        i.tipo === 'grupo'
          ? h('li', { class: 'ui-subs__grupo' }, createGrupoHead())
          : h('li', { class: 'ui-subs__item' }, createAgentRow(i.agent, (id) => this.pick(id), 'sm')),
      update: (li2, i) => (i.tipo === 'grupo' ? updateGrupoHead(li2.firstElementChild as HTMLElement, i) : this.updateRow(li2.firstElementChild as HTMLElement, i.agent)),
    });
    this.nodeRefs.set(li, { row, head, subsWrap, subsCaption, subs });
    return li;
  }

  private updateNode(li: HTMLElement, n: AgentNode): void {
    const r = this.nodeRefs.get(li)!;
    const sig = this.assinaturaDoNo(n);
    if (r.sig === sig) return;
    r.sig = sig;
    this.updateRow(r.row, n.agent);
    r.head.dataset.id = n.agent.id;
    r.head.dataset.room = n.agent.roomId;
    const has = n.subTotal > 0;
    setHidden(r.subsWrap, !has);
    if (has) {
      const shown = n.subs.length;
      setText(r.subsCaption, shown === n.subTotal ? plural(n.subTotal, 'subagente', 'subagentes') : `${shown} de ${plural(n.subTotal, 'subagente', 'subagentes')}`);
    }
    r.subs.sync(itensDeSubs(n.subs, (id) => this.ctx.agent(id)?.name, this.ctx.store.snapshot?.equipes));
  }

  private updateRow(row: HTMLElement, a: AgentInfo): void {
    updateAgentRow(row, a, this.ctx.account(a.account), this.selecionado(a), this.agora, this.agentes);
  }

  private pick(id: string): void {
    this.ctx.select({ type: 'agent', id }, { focus: true });
    if (this.ctx.isNarrow()) this.ctx.togglePanel('sidebar', false);
  }
}
