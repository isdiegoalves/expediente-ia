// Vida social no servidor: avança a agenda das rodas (shared/social/agenda.ts) a cada segundo com os
// agentes do snapshot, publica rodas, carteiras e o ritmo no snapshot e guarda o livro das carteiras e o
// ritmo em <dataDir>/social.json, para que todas as abas e o mod vejam o mesmo e um reinício não o zere.
import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { MotorSocial } from '../../shared/social/agenda';
import { lerRitmo, type Ritmo } from '../../shared/social/regras';
import type { AgentInfo, SocialSnapshot } from '../../shared/types';
import { errMsg, log } from '../log';

export const SOCIAL_ARQUIVO = 'social.json';
const PASSO_MS = 1_000;
const GRAVAR_MS = 5_000;

export interface LivroSocialOpcoes {
  /** <dataDir>/social.json; null = só em memória. */
  arquivo: string | null;
  /** Agentes do snapshot atual (os do demo inclusive: o navegador anima todos). */
  agentes: () => readonly AgentInfo[];
  /** Avisado quando rodas ou carteiras mudam, para o snapshot sair de novo. */
  mudou: () => void;
  now?: () => number;
}

export class LivroSocial {
  private readonly motor: MotorSocial;
  private readonly now: () => number;
  private atual: SocialSnapshot;
  private assinatura = '';
  private gravarEm = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly o: LivroSocialOpcoes) {
    this.now = o.now ?? Date.now;
    const salvo = this.ler();
    this.motor = new MotorSocial(salvo.semente ?? randomInt(1, 2 ** 31), salvo.carteiras, salvo.ritmo);
    this.atual = this.motor.estado();
  }

  start(): void {
    this.timer = setInterval(() => {
      try {
        this.passo();
      } catch (err) {
        log.warnOnce(`social:${errMsg(err)}`, `Falha na agenda das rodas: ${errMsg(err)}`);
      }
    }, PASSO_MS);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.gravar();
  }

  passo(): void {
    const agora = this.now();
    this.motor.passo(agora, this.o.agentes());
    this.publicar();
    if (agora >= this.gravarEm) {
      this.gravarEm = agora + GRAVAR_MS;
      if (this.motor.carteiras.takeDirty()) this.gravar();
    }
  }

  estado(): SocialSnapshot {
    return this.atual;
  }

  /** Ritmo escolhido nas Configurações: vale já para todas as abas e fica gravado. */
  mudarRitmo(ritmo: Ritmo): void {
    this.motor.mudarRitmo(ritmo);
    this.publicar();
    this.gravar();
  }

  private publicar(): void {
    this.atual = this.motor.estado();
    const assinatura = JSON.stringify(this.atual);
    if (assinatura === this.assinatura) return;
    this.assinatura = assinatura;
    this.o.mudou();
  }

  /** Troca o arquivo inteiro de uma vez (temporário + rename): um corte no meio nunca deixa meio livro. */
  gravar(): void {
    const arquivo = this.o.arquivo;
    if (!arquivo) return;
    try {
      mkdirSync(dirname(arquivo), { recursive: true });
      const tmp = `${arquivo}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify({ v: 1, semente: this.motor.semente, ritmo: this.motor.ritmo, carteiras: this.motor.carteiras.toJSON() }));
      renameSync(tmp, arquivo);
      log.clearOnce('social-gravar');
    } catch (err) {
      log.warnOnce('social-gravar', `Não foi possível gravar ${arquivo} (${errMsg(err)}); as carteiras valem só nesta execução.`);
    }
  }

  private ler(): { semente?: number; ritmo?: Ritmo; carteiras?: unknown } {
    if (!this.o.arquivo) return {};
    try {
      const j = JSON.parse(readFileSync(this.o.arquivo, 'utf8')) as { semente?: unknown; ritmo?: unknown; carteiras?: unknown } | null;
      const semente = typeof j?.semente === 'number' && Number.isSafeInteger(j.semente) && j.semente > 0 ? j.semente : undefined;
      return { semente, ritmo: lerRitmo(j?.ritmo), carteiras: j?.carteiras };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`${this.o.arquivo} ilegível (${errMsg(err)}); as carteiras começam do zero e o ritmo volta a normal.`);
      return {};
    }
  }
}
