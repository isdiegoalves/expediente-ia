// "Desde que você saiu": o que a janela desenha. Funções puras (sem DOM), testadas em ui/resumo-model.test.ts.
import type { EstadoResumo, ResumoView, SessaoResumo } from '../../../shared/resumo';
import { formatDuration } from './format';

export const ESTADO_ROTULO: Record<EstadoResumo, string> = {
  espera: 'espera você',
  travou: 'travou',
  terminou: 'terminou',
  trabalhando: 'trabalhando',
  ociosa: 'ociosa',
};

/** Mais sessões que isto a janela não mostra (duas colunas de 8), mesmo com altura de sobra. */
export const MAX_LINHAS = 16;

/** O maior número de linhas, de `max` para baixo (no mínimo 1), para o qual `cabe` diz que a janela não corta nada. */
export function maiorQueCabe(max: number, cabe: (linhas: number) => boolean): number {
  let n = Math.max(1, max);
  while (n > 1 && !cabe(n)) n--;
  return n;
}

export function recortar(sessoes: readonly SessaoResumo[], max: number): { visiveis: SessaoResumo[]; restantes: number } {
  return { visiveis: sessoes.slice(0, max), restantes: Math.max(0, sessoes.length - max) };
}

/** "Você saiu há 2 h" ou, sem saída conhecida, desde que a página abriu. */
export function ausenciaTexto(view: Pick<ResumoView, 'desde' | 'agora'>, saiuConhecida: boolean): string {
  const tempo = formatDuration(view.agora - view.desde);
  return saiuConhecida ? `Você saiu há ${tempo}` : `Desde que esta página abriu, há ${tempo}`;
}

/** Aceita "2h", "90m" (o simulador do ?mock=1 usa para fingir uma saída); outro formato = undefined. */
export function ausenciaDoMock(valor: string | null): number | undefined {
  const m = valor ? /^(\d{1,3})(h|m)$/.exec(valor) : null;
  return m ? Number(m[1]) * (m[2] === 'h' ? 3_600_000 : 60_000) : undefined;
}

/** Muda só quando o desenho muda: `agora` da vista fica de fora e o relógio entra por minuto ("há 1 h"). */
export function chaveDoDesenho(view: ResumoView, alturaDaJanela: number, saiuConhecida: boolean, agora: number): string {
  return JSON.stringify([{ ...view, agora: 0 }, alturaDaJanela, saiuConhecida, Math.floor(agora / 60_000)]);
}
