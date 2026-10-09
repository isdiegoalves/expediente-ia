// Validação do tema sem dependência: o subconjunto de JSON Schema que tema.schema.json usa, mais o contraste
// WCAG com alpha composto. Usado pelo servidor, pelo cliente e por scripts/preflight-tema.mjs.

export interface Parede {
  base: string;
  friso: string;
  padrao: string;
}

export interface Imagem {
  arquivo: string;
  largura: number;
  altura: number;
}

export interface Quadro {
  id: string;
  tipo: 'painting' | 'poster';
  arquivo: string;
  tiles?: number;
  moldura?: Imagem;
  variante?: string;
}

export interface Sala {
  tapete: string;
  tapete2: string;
  parede: Parede;
  destaque: string;
  mesa: string;
  cadeira: string;
}

export interface Tema {
  versao: 1;
  id: string;
  nome: string;
  origem: { tipo: string; fontes: { tipo: string; referencia: string; coletadoEm?: string }[] };
  paleta: {
    ui: Record<'fundo' | 'fundoSolido' | 'fundoSuave' | 'fundoHover' | 'linha' | 'linhaForte' | 'texto' | 'textoMudo' | 'textoFraco' | 'destaque' | 'destaqueSuave', string>;
    status: Record<StatusChave, string>;
    nivel: Record<'ok' | 'atencao' | 'critico', string>;
    marca: { letreiro: string[]; simbolo: string[]; estrela: string };
    salas: Sala[];
    nucleo: Record<'recepcao' | 'banheiros' | 'copa' | 'copaRevestimento' | 'lounge' | 'vidro', Parede>;
    piso: Record<'carpete' | 'xadrez' | 'azulejo' | 'grama' | 'rua' | 'madeira', string[]>;
    canvas: Record<'rotuloFundo' | 'rotuloTexto' | 'rotuloSombra' | 'rotuloContorno' | 'compactoFundo' | 'compactoTexto', string>;
    mundo: { fundoExterno: string; anelSelecao: string; anelHover: string; telhado: string[] };
  };
  contraste: { texto: string; fundo: string; sobre?: string; min: number }[];
  textos: {
    produto: string;
    status: Record<StatusChave, string>;
    areasNucleo: Record<'recepcao' | 'banheiros' | 'copa' | 'lounge', string>;
    salas?: { pasta: string; nome: string }[];
  };
  tipografia: { familia: string; arquivo: string; licenca: string; equivalenteDe?: string };
  decoracao: { marca: { logo: Imagem; placa: Imagem }; quadros: Quadro[] };
}

export type StatusChave = 'trabalhando' | 'esperando' | 'shell' | 'ocioso' | 'concluido' | 'saindo';

interface Esquema {
  $ref?: string;
  type?: string | string[];
  required?: string[];
  properties?: Record<string, Esquema>;
  additionalProperties?: boolean | Esquema;
  pattern?: string;
  enum?: unknown[];
  items?: Esquema;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  const?: unknown;
  [chave: string]: unknown;
}

const IGNORADAS = new Set(['$schema', '$id', '$defs', '$comment', 'title', 'description', 'examples', 'default', 'format']);
const CONFERIDAS = new Set(['$ref', 'type', 'required', 'properties', 'additionalProperties', 'pattern', 'enum', 'items', 'minItems', 'maxItems', 'minLength', 'maxLength', 'minimum', 'maximum', 'const']);

function tipoDe(v: unknown): string {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

/** Devolve a lista de falhas (vazia = válido). Palavra-chave fora do subconjunto conta como falha: o schema nunca vira letra morta. */
export function validar(esquema: Esquema, valor: unknown, raiz: Esquema = esquema, caminho = '$'): string[] {
  if (esquema.$ref) {
    const alvo = esquema.$ref.replace(/^#\//, '').split('/').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], raiz) as Esquema | undefined;
    return alvo ? validar(alvo, valor, raiz, caminho) : [`${caminho}: $ref não resolvido ${esquema.$ref}`];
  }
  const out: string[] = [];
  for (const k of Object.keys(esquema)) if (!CONFERIDAS.has(k) && !IGNORADAS.has(k)) out.push(`${caminho}: palavra-chave "${k}" não é conferida pelo validador`);
  const tipo = tipoDe(valor);
  if (esquema.type) {
    const ok = [esquema.type].flat().some((t) => t === tipo || (t === 'number' && tipo === 'integer'));
    if (!ok) return [`${caminho}: tipo ${tipo}, esperado ${[esquema.type].flat().join('|')}`];
  }
  if (esquema.const !== undefined && JSON.stringify(esquema.const) !== JSON.stringify(valor)) out.push(`${caminho}: diferente de ${JSON.stringify(esquema.const)}`);
  if (esquema.enum && !esquema.enum.some((e) => JSON.stringify(e) === JSON.stringify(valor))) out.push(`${caminho}: fora do enum`);
  if (typeof valor === 'string') {
    if (esquema.pattern && !new RegExp(esquema.pattern, 'u').test(valor)) out.push(`${caminho}: "${valor}" não casa ${esquema.pattern}`);
    if (esquema.minLength !== undefined && valor.length < esquema.minLength) out.push(`${caminho}: curto demais`);
    if (esquema.maxLength !== undefined && valor.length > esquema.maxLength) out.push(`${caminho}: longo demais`);
  }
  if (typeof valor === 'number') {
    if (esquema.minimum !== undefined && valor < esquema.minimum) out.push(`${caminho}: abaixo do mínimo`);
    if (esquema.maximum !== undefined && valor > esquema.maximum) out.push(`${caminho}: acima do máximo`);
  }
  if (Array.isArray(valor)) {
    if (esquema.minItems !== undefined && valor.length < esquema.minItems) out.push(`${caminho}: itens de menos`);
    if (esquema.maxItems !== undefined && valor.length > esquema.maxItems) out.push(`${caminho}: itens demais`);
    const itens = esquema.items;
    if (itens) valor.forEach((v, i) => out.push(...validar(itens, v, raiz, `${caminho}[${i}]`)));
  } else if (tipo === 'object') {
    const obj = valor as Record<string, unknown>;
    for (const r of esquema.required ?? []) if (!Object.hasOwn(obj, r)) out.push(`${caminho}: falta "${r}"`);
    const props = esquema.properties ?? {};
    for (const [k, v] of Object.entries(obj)) {
      if (Object.hasOwn(props, k)) out.push(...validar(props[k], v, raiz, `${caminho}.${k}`));
      else if (esquema.additionalProperties === false) out.push(`${caminho}: propriedade não prevista "${k}"`);
      else if (typeof esquema.additionalProperties === 'object') out.push(...validar(esquema.additionalProperties, v, raiz, `${caminho}.${k}`));
    }
  }
  return out;
}

// ---------------------------------------------------------------- contraste

type Rgba = [number, number, number, number];

export function rgbaDe(cor: unknown): Rgba | null {
  if (typeof cor !== 'string') return null;
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(cor);
  if (!m) return null;
  const c = (i: number) => parseInt(m[1].slice(i, i + 2), 16);
  return [c(0), c(2), c(4), m[2] ? parseInt(m[2], 16) / 255 : 1];
}

const compor = (fg: Rgba, bg: Rgba): Rgba => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1) as Rgba;

function luminancia(c: Rgba): number {
  const [r, g, b] = c.slice(0, 3).map((x) => {
    const v = x / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function razao(a: Rgba, b: Rgba): number {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (maior + 0.05) / (menor + 0.05);
}

/** Cor da paleta por caminho pontuado ("ui.texto", "piso.azulejo.2"). */
export function corPorCaminho(paleta: unknown, caminho: string): unknown {
  return caminho.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), paleta);
}

export interface MedidaContraste {
  par: string;
  razao: number;
  min: number;
}

/** Mede os pares de `contraste` compondo o alpha do fundo sobre `sobre` (e o do texto sobre o fundo composto). */
export function medirContraste(tema: Pick<Tema, 'paleta' | 'contraste'>): { medidas: MedidaContraste[]; erros: string[] } {
  const medidas: MedidaContraste[] = [];
  const erros: string[] = [];
  for (const p of tema.contraste) {
    const par = `${p.texto} sobre ${p.fundo}${p.sobre ? ` (composto sobre ${p.sobre})` : ''}`;
    const t = rgbaDe(corPorCaminho(tema.paleta, p.texto));
    const f = rgbaDe(corPorCaminho(tema.paleta, p.fundo));
    const s = p.sobre ? rgbaDe(corPorCaminho(tema.paleta, p.sobre)) : null;
    if (!t || !f) {
      erros.push(`contraste: cor ausente ou ilegível em ${par}`);
      continue;
    }
    if (f[3] < 1 && (!s || s[3] < 1)) {
      erros.push(`contraste: ${p.fundo} tem alpha ${f[3].toFixed(2)} e o par não diz sobre que cor opaca compõe ("sobre")`);
      continue;
    }
    const fundo = f[3] < 1 && s ? compor(f, s) : f;
    const texto = t[3] < 1 ? compor(t, fundo) : t;
    const r = razao(texto, fundo);
    medidas.push({ par, razao: r, min: p.min });
    if (r < p.min) erros.push(`contraste ${r.toFixed(2)}:1 < ${p.min} em ${par}`);
  }
  return { medidas, erros };
}

/** O tema de marca não escolhe ficar de fora: precisa declarar ao menos os pares (texto, fundo) do padrão, com mínimo igual ou maior. */
export function paresFaltando(tema: Pick<Tema, 'contraste'>, padrao: Pick<Tema, 'contraste'>): string[] {
  const falta: string[] = [];
  for (const p of padrao.contraste) {
    const meu = tema.contraste.find((c) => c.texto === p.texto && c.fundo === p.fundo);
    if (!meu) falta.push(`falta o par de contraste ${p.texto} sobre ${p.fundo}`);
    else if (meu.min < p.min) falta.push(`par ${p.texto} sobre ${p.fundo} com mínimo ${meu.min}, o padrão exige ${p.min}`);
  }
  return falta;
}
