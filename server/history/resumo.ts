// Quando você saiu: cada aba avisa se está visível, e quando a última aba visível some o servidor grava a hora em
// <dataDir>/resumo.json (sobrevive ao reinício). A volta depois de LIMITE_AUSENCIA_MS pede ao cliente que abra o resumo.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { LIMITE_AUSENCIA_MS, type PresencaResposta } from '../../shared/resumo';
import { errMsg, log } from '../log';

interface Estado {
  version: 1;
  saiuEm: number | null;
  fora: boolean;
}

export class Presenca {
  private visiveis = new Set<string>();
  private saiuEm: number | null = null;
  private fora = false;

  /** `file` null = só em memória. */
  constructor(
    private readonly file: string | null,
    private readonly now: () => number = Date.now,
  ) {}

  load(): void {
    if (!this.file) return;
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<Estado>;
      if (typeof j.saiuEm === 'number' && Number.isFinite(j.saiuEm)) this.saiuEm = j.saiuEm;
      this.fora = j.fora === true && this.saiuEm !== null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warn(`resumo.json ilegível (${errMsg(err)}); começando do zero.`);
    }
  }

  get ultimaSaida(): number | null {
    return this.saiuEm;
  }

  visivel(aba: string): PresencaResposta {
    const agora = this.now();
    const estavaFora = this.visiveis.size === 0 && this.fora;
    this.visiveis.add(aba);
    const mostrar = estavaFora && this.saiuEm !== null && agora - this.saiuEm >= LIMITE_AUSENCIA_MS;
    if (this.fora) {
      this.fora = false;
      this.gravar();
    }
    return { saiuEm: this.saiuEm, mostrar };
  }

  oculta(aba: string): PresencaResposta {
    this.visiveis.delete(aba);
    if (this.visiveis.size === 0 && !this.fora) {
      this.fora = true;
      this.saiuEm = this.now();
      this.gravar();
    }
    return { saiuEm: this.saiuEm, mostrar: false };
  }

  private gravar(): void {
    if (!this.file) return;
    const data: Estado = { version: 1, saiuEm: this.saiuEm, fora: this.fora };
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(data));
      renameSync(tmp, this.file);
      log.clearOnce('resumo-write');
    } catch (err) {
      log.warnOnce('resumo-write', `Não foi possível gravar ${this.file} (${errMsg(err)}); a hora da saída vale só nesta execução.`);
    }
  }
}
