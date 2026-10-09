// Escreve a paleta e a fonte do tema na página. Cor só entra depois de conferir o padrão hexadecimal.
import type { Tema } from '../../../shared/tema/validar';
import { TEMA_PADRAO, urlDoTema } from './index';

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const FAMILIA = /^[A-Za-z0-9][A-Za-z0-9 -]{0,39}$/;

const opaca = (hex: string): string => hex.slice(0, 7);

export function variaveisCss(t: Tema): [string, string][] {
  const { ui, status, nivel } = t.paleta;
  return [
    ['--ui-bg', ui.fundo],
    ['--ui-bg-solid', ui.fundoSolido],
    ['--ui-bg-soft', ui.fundoSuave],
    ['--ui-bg-hover', ui.fundoHover],
    ['--ui-line', ui.linha],
    ['--ui-line-strong', ui.linhaForte],
    ['--ui-text', ui.texto],
    ['--ui-muted', ui.textoMudo],
    ['--ui-faint', ui.textoFraco],
    ['--ui-accent', ui.destaque],
    ['--ui-accent-soft', ui.destaqueSuave],
    ['--ui-bg-opaco', opaca(ui.fundo)],
    ['--ui-bg-solid-opaco', opaca(ui.fundoSolido)],
    ['--st-working', status.trabalhando],
    ['--st-waiting', status.esperando],
    ['--st-shell', status.shell],
    ['--st-idle', status.ocioso],
    ['--st-done', status.concluido],
    ['--st-offline', status.saindo],
    ['--lv-ok', nivel.ok],
    ['--lv-warn', nivel.atencao],
    ['--lv-crit', nivel.critico],
  ];
}

export function aplicarPaleta(t: Tema, root: HTMLElement = document.documentElement): void {
  for (const [nome, cor] of variaveisCss(t)) if (HEX.test(cor)) root.style.setProperty(nome, cor);
}

/** Registra a fonte do tema quando ela não é a do padrão (o padrão segue pelo pacote da fonte, com todos os pesos). */
export async function aplicarFonte(t: Tema, root: HTMLElement = document.documentElement): Promise<void> {
  const { familia, arquivo } = t.tipografia;
  if (familia === TEMA_PADRAO.tipografia.familia || !FAMILIA.test(familia)) return;
  try {
    const fonte = new FontFace(familia, `url(${urlDoTema(arquivo)})`);
    document.fonts.add(await fonte.load());
    root.style.setProperty('--font-px', `'${familia}', system-ui, sans-serif`);
  } catch {
    // fonte ausente ou ilegível: fica a do padrão
  }
}
