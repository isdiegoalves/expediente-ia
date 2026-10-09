// Cores do canvas que o tema não declara uma a uma: saem dos tokens de `paleta` por mistura, para que trocar a
// paleta troque também balões, etiquetas, faixa da rua e vinheta.
import { mix, toHex, withAlpha } from '../art/core/color';
import type { Tema } from '../../../shared/tema/validar';
import { tema } from './index';

export const opaca = (hex: string): string => hex.slice(0, 7);

export interface TomDoBalao {
  fundo: string;
  borda: string;
  texto: string;
}

export interface CoresDerivadas {
  /** Tinta escura e clara dos rótulos: base de tudo que o canvas escurece ou clareia. */
  escuro: string;
  claro: string;
  placa: { sombraEscura: string; sombraClara: string; textoEscuro: string; textoClaro: string };
  chip: { realce: string };
  balao: Record<'info' | 'alert' | 'deliver' | 'shell' | 'say', TomDoBalao>;
  sombraDoBalao: string;
  sombraDoBalaoLeve: string;
  etiqueta: { selecionada: string; espera: string; normal: string; chipEscuro: string; chipClaro: string; cracha: string; textoDoCracha: string };
  mundo: {
    vinheta: [number, number, number];
    faixaDaRua: string;
    vidro: string;
    anelDeAlerta: string;
    sombraDaBola: string;
    noite: string;
  };
}

export function derivar(t: Tema): CoresDerivadas {
  const { canvas, status, ui, mundo, nucleo } = t.paleta;
  const escuro = opaca(canvas.rotuloContorno);
  const fundo = opaca(canvas.rotuloFundo);
  const claro = canvas.rotuloTexto;
  const textoAlerta = mix(status.esperando, escuro, 0.88);
  const vinheta = mix(mundo.fundoExterno, fundo, 0.8);
  const [vr, vg, vb] = [1, 3, 5].map((i) => parseInt(vinheta.slice(i, i + 2), 16));
  return {
    escuro,
    claro,
    placa: {
      sombraEscura: withAlpha(escuro, 0.35),
      sombraClara: withAlpha(claro, 0.45),
      textoEscuro: claro,
      textoClaro: fundo,
    },
    chip: { realce: withAlpha(claro, 0.14) },
    balao: {
      alert: { fundo: mix(status.esperando, claro, 0.22), borda: mix(status.esperando, escuro, 0.3), texto: textoAlerta },
      deliver: { fundo: mix(status.concluido, claro, 0.8), borda: mix(status.concluido, claro, 0.1), texto: mix(status.concluido, escuro, 0.82) },
      shell: { fundo: mix(fundo, status.shell, 0.06), borda: mix(fundo, ui.destaque, 0.35), texto: mix(status.trabalhando, claro, 0.6) },
      say: { fundo: claro, borda: withAlpha(fundo, 0.38), texto: escuro },
      info: { fundo: mix(claro, status.esperando, 0.04), borda: withAlpha(fundo, 0.22), texto: fundo },
    },
    sombraDoBalao: withAlpha(opaca(canvas.rotuloSombra), 0.22),
    sombraDoBalaoLeve: withAlpha(opaca(canvas.rotuloSombra), 0.2),
    etiqueta: {
      selecionada: withAlpha(mix(ui.destaque, escuro, 0.6), 0.95),
      espera: withAlpha(mix(status.esperando, escuro, 0.6), 0.92),
      normal: withAlpha(fundo, 0.82),
      chipEscuro: escuro,
      chipClaro: claro,
      cracha: status.esperando,
      textoDoCracha: textoAlerta,
    },
    mundo: {
      vinheta: [vr, vg, vb],
      faixaDaRua: withAlpha(mix(status.esperando, claro, 0.6), 0.75),
      vidro: nucleo.vidro.base,
      anelDeAlerta: status.esperando,
      sombraDaBola: withAlpha(escuro, 0.35),
      noite: escuro,
    },
  };
}

let memo: { de: Tema; cores: CoresDerivadas } | undefined;

export function coresDerivadas(): CoresDerivadas {
  const t = tema();
  if (memo?.de !== t) memo = { de: t, cores: derivar(t) };
  return memo.cores;
}

/** Cor opaca `#rrggbb` a partir de componentes 0–255. */
export const rgbHex = (r: number, g: number, b: number): string => toHex(r, g, b);
