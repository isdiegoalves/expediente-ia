// DOM mínimo para testar a lista lateral sem navegador: guarda a árvore e conta, por nó, cada leitura e escrita de conteúdo.

export const registro = {
  criados: 0,
  removidos: 0,
  movidos: 0,
  /** Nós cujo conteúdo foi lido ou escrito (a árvore em si, como `nextSibling`, não conta). */
  tocados: new Set<Elemento>(),
  /** Nós cujo conteúdo mudou de verdade. */
  alterados: new Set<Elemento>(),
};

export function zerarRegistro(): void {
  registro.criados = 0;
  registro.removidos = 0;
  registro.movidos = 0;
  registro.tocados.clear();
  registro.alterados.clear();
}

class Texto {
  parentNode: Elemento | null = null;
  constructor(public texto: string) {}
}

type No = Elemento | Texto;

export class Elemento {
  parentNode: Elemento | null = null;
  filhos: No[] = [];
  attrs = new Map<string, string>();
  estilo = new Map<string, string>();
  dados: Record<string, string> = {};
  classes = new Set<string>();
  escondido = false;
  html = '';
  texto = '';
  valor = '';

  constructor(readonly tag: string) {
    registro.criados++;
  }

  private tocar(): void {
    registro.tocados.add(this);
  }

  private mudou(): void {
    registro.alterados.add(this);
  }

  private escrever<T>(atual: T, novo: T, aplicar: () => void): void {
    this.tocar();
    if (atual === novo) return;
    aplicar();
    this.mudou();
  }

  get className(): string {
    this.tocar();
    return [...this.classes].join(' ');
  }

  set className(v: string) {
    this.escrever(this.className, v, () => (this.classes = new Set(v.split(/\s+/).filter(Boolean))));
  }

  readonly classList = {
    add: (...nomes: string[]) => {
      this.tocar();
      for (const n of nomes) if (!this.classes.has(n)) (this.classes.add(n), this.mudou());
    },
    remove: (...nomes: string[]) => {
      this.tocar();
      for (const n of nomes) if (this.classes.delete(n)) this.mudou();
    },
    toggle: (nome: string, forca?: boolean) => {
      this.tocar();
      const quer = forca ?? !this.classes.has(nome);
      if (quer && !this.classes.has(nome)) (this.classes.add(nome), this.mudou());
      else if (!quer && this.classes.delete(nome)) this.mudou();
      return quer;
    },
    contains: (nome: string) => {
      this.tocar();
      return this.classes.has(nome);
    },
  };

  readonly style = {
    setProperty: (nome: string, v: string) => this.escrever(this.estilo.get(nome), v, () => this.estilo.set(nome, v)),
    getPropertyValue: (nome: string) => {
      this.tocar();
      return this.estilo.get(nome) ?? '';
    },
    removeProperty: (nome: string) => this.escrever(this.estilo.has(nome), false, () => this.estilo.delete(nome)),
  };

  readonly dataset: Record<string, string | undefined> = new Proxy(this.dados, {
    get: (alvo, chave: string) => {
      this.tocar();
      return alvo[chave];
    },
    set: (alvo, chave: string, v: string) => {
      this.escrever(alvo[chave], v, () => (alvo[chave] = v));
      return true;
    },
  });

  get hidden(): boolean {
    this.tocar();
    return this.escondido;
  }

  set hidden(v: boolean) {
    this.escrever(this.escondido, v, () => (this.escondido = v));
  }

  get title(): string {
    this.tocar();
    return this.attrs.get('title') ?? '';
  }

  set title(v: string) {
    this.setAttribute('title', v);
  }

  get value(): string {
    return this.valor;
  }

  set value(v: string) {
    this.valor = v;
  }

  set tabIndex(_: number) {
    this.tocar();
  }

  set draggable(v: boolean) {
    this.setAttribute('draggable', String(v));
  }

  set innerHTML(v: string) {
    this.escrever(this.html, v, () => (this.html = v));
  }

  get textContent(): string {
    this.tocar();
    return this.filhos.length ? this.filhos.map((f) => (f instanceof Texto ? f.texto : f.textContent)).join('') : this.texto;
  }

  set textContent(v: string) {
    this.tocar();
    for (const f of this.filhos) f.parentNode = null;
    this.filhos = [];
    this.texto = v;
    this.mudou();
  }

  getAttribute(nome: string): string | null {
    this.tocar();
    return this.attrs.get(nome) ?? null;
  }

  hasAttribute(nome: string): boolean {
    this.tocar();
    return this.attrs.has(nome);
  }

  setAttribute(nome: string, v: string): void {
    this.escrever(this.attrs.get(nome), v, () => this.attrs.set(nome, v));
  }

  removeAttribute(nome: string): void {
    this.escrever(this.attrs.has(nome), false, () => this.attrs.delete(nome));
  }

  addEventListener(): void {}
  focus(): void {}
  blur(): void {}
  select(): void {}
  querySelector(): null {
    return null;
  }
  querySelectorAll(): Elemento[] {
    return [];
  }

  get children(): Elemento[] {
    return this.filhos.filter((f): f is Elemento => f instanceof Elemento);
  }

  get firstChild(): No | null {
    return this.filhos[0] ?? null;
  }

  get firstElementChild(): Elemento | null {
    return this.children[0] ?? null;
  }

  get lastElementChild(): Elemento | null {
    return this.children.at(-1) ?? null;
  }

  get nextSibling(): No | null {
    const irmaos = this.parentNode?.filhos;
    return irmaos?.[irmaos.indexOf(this) + 1] ?? null;
  }

  get isConnected(): boolean {
    return true;
  }

  append(...nos: (No | string)[]): void {
    for (const n of nos) this.insertBefore(typeof n === 'string' ? new Texto(n) : n, null);
  }

  insertBefore(no: No, ref: No | null): void {
    if (no.parentNode) {
      registro.movidos++;
      no.parentNode.filhos.splice(no.parentNode.filhos.indexOf(no), 1);
    }
    const i = ref ? this.filhos.indexOf(ref) : -1;
    if (i < 0) this.filhos.push(no);
    else this.filhos.splice(i, 0, no);
    no.parentNode = this;
  }

  remove(): void {
    if (!this.parentNode) return;
    registro.removidos++;
    this.parentNode.filhos.splice(this.parentNode.filhos.indexOf(this), 1);
    this.parentNode = null;
  }

  /** Os filhos de um nó, sem contar como leitura. */
  descendentes(): Elemento[] {
    return this.children.flatMap((f) => [f, ...f.descendentes()]);
  }
}

/** Serializa o que se vê para comparar duas listas: classes e atributos em ordem fixa, sem o conteúdo de nó oculto e sem a classe de entrada (cai no `animationend`, que aqui não existe). */
export function serializar(no: No): string {
  if (no instanceof Texto) return no.texto;
  const attrs = [...no.attrs].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${JSON.stringify(v)}`);
  const estilo = [...no.estilo].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${v}`);
  const dados = Object.entries(no.dados).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`);
  const cab = `${no.tag}.${[...no.classes].filter((c) => c !== 'is-entering').sort().join('.')}${no.escondido ? '[oculto]' : ''}[${attrs.join(' ')}]{${estilo.join(';')}}<${dados.join(',')}>`;
  if (no.escondido) return `(${cab})`;
  return `(${cab}${no.html}${no.filhos.length ? no.filhos.map(serializar).join('') : no.texto})`;
}

export function instalarFalsoDom(): { guardado: Map<string, string> } {
  const guardado = new Map<string, string>();
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { createElement: (tag: string) => new Elemento(tag) };
  g.HTMLElement = Elemento;
  g.CSS = { escape: (s: string) => s };
  g.localStorage = {
    getItem: (k: string) => guardado.get(k) ?? null,
    setItem: (k: string, v: string) => void guardado.set(k, v),
  };
  return { guardado };
}

export function removerFalsoDom(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  for (const k of ['document', 'HTMLElement', 'CSS', 'localStorage']) delete g[k];
}
