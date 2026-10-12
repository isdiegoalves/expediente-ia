// O tema ativo do servidor, conferido de novo no disco de tempos em tempos: gravar tema-ativo troca o tema sem reiniciar.
// A pasta do host é montagem do Docker, onde o fs.watch não avisa; por isso a conferência é um stat com intervalo mínimo.
import { errMsg, log } from '../log';
import { assinaturaDoTema, carregarTema, chaveDoTema, type PastasDoTema, type TemaCarregado } from './carregar';

export class TemaAtivo {
  private atual: TemaCarregado;
  private assinatura: string;
  private conferidoEm: number;
  private readonly ouvintes = new Set<(tema: TemaCarregado) => void>();

  constructor(
    private readonly pastas: PastasDoTema,
    private readonly agora: () => number = Date.now,
    private readonly intervaloMs = 1_000,
  ) {
    this.assinatura = assinaturaDoTema(pastas);
    this.atual = carregarTema(pastas);
    this.conferidoEm = agora();
  }

  /** O tema ativo; confere o disco no máximo uma vez por intervalo. */
  get(): TemaCarregado {
    this.conferir();
    return this.atual;
  }

  conferir(): void {
    const t = this.agora();
    if (t >= this.conferidoEm && t - this.conferidoEm < this.intervaloMs) return;
    this.conferidoEm = t;
    const assinatura = assinaturaDoTema(this.pastas);
    if (assinatura === this.assinatura) return;
    this.assinatura = assinatura;
    this.atual = carregarTema(this.pastas);
    for (const ouvinte of this.ouvintes) ouvinte(this.atual);
  }

  aoTrocar(ouvinte: (tema: TemaCarregado) => void): () => void {
    this.ouvintes.add(ouvinte);
    return () => void this.ouvintes.delete(ouvinte);
  }
}

/** Confere o tema ativo a cada `intervaloMs` e avisa as páginas abertas quando ele muda. Devolve quem para. */
export function vigiarTema(temas: TemaAtivo, hub: { avisarTema(chave: string): void }, intervaloMs = 2_000): () => void {
  hub.avisarTema(chaveDoTema(temas.get()));
  const parar = temas.aoTrocar((t) => {
    log.info(`Tema ativo trocado para ${t.id}.`);
    if (t.aviso) log.warn(t.aviso);
    hub.avisarTema(chaveDoTema(t));
  });
  const timer = setInterval(() => {
    try {
      temas.conferir();
    } catch (err) {
      log.warnOnce(`tema:${errMsg(err)}`, `Falha ao conferir o tema ativo: ${errMsg(err)}`);
    }
  }, intervaloMs);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    parar();
  };
}
