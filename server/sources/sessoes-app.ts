// Mapa agente -> sessão do app desktop: lê `sessoes-app.json`, que o mod grava em ~/.expediente/host
// (mod/expediente/hooks/ponte.ts) com sessionId, cliSessionId e isArchived de cada sessão do app.
import { readFileSync, statSync } from 'node:fs';
import type { AgentOrigin } from '../../shared/types';

/** Sem mod rodando o arquivo envelhece: depois disto o mapa é ignorado. */
export const MAX_IDADE_PONTE_MS = 60_000;

const ID_APP = /^local_[A-Za-z0-9-]{1,64}$/;
const ID_CLI = /^[A-Za-z0-9-]{1,64}$/;

export interface SessoesApp {
  geradoEm: number;
  /** cliSessionId (nome do transcript) -> `local_<uuid>`, só das sessões não arquivadas. */
  porCli: ReadonlyMap<string, string>;
}

export function parseSessoesApp(raw: string): SessoesApp | undefined {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return undefined;
  const { geradoEm, sessoes } = j as { geradoEm?: unknown; sessoes?: unknown };
  if (typeof geradoEm !== 'number' || !Number.isFinite(geradoEm) || !Array.isArray(sessoes)) return undefined;
  const porCli = new Map<string, string>();
  for (const s of sessoes) {
    if (!s || typeof s !== 'object') continue;
    const { sessionId, cliSessionId, isArchived } = s as { sessionId?: unknown; cliSessionId?: unknown; isArchived?: unknown };
    if (isArchived === true) continue;
    if (typeof sessionId !== 'string' || !ID_APP.test(sessionId)) continue;
    if (typeof cliSessionId !== 'string' || !ID_CLI.test(cliSessionId)) continue;
    porCli.set(cliSessionId, sessionId);
  }
  return { geradoEm, porCli };
}

/** Relê o arquivo só quando tamanho ou data mudam; um arquivo ilegível (troca em andamento) mantém a última versão boa. */
export class SessoesAppReader {
  private last: { size: number; mtimeMs: number; mapa?: SessoesApp } | undefined;

  constructor(readonly file: string) {}

  read(now: number): ReadonlyMap<string, string> {
    let st;
    try {
      st = statSync(this.file);
    } catch {
      this.last = undefined;
      return new Map();
    }
    if (!this.last || this.last.size !== st.size || this.last.mtimeMs !== st.mtimeMs) {
      let mapa: SessoesApp | undefined;
      try {
        mapa = parseSessoesApp(readFileSync(this.file, 'utf8'));
      } catch {
        mapa = undefined;
      }
      this.last = { size: st.size, mtimeMs: st.mtimeMs, mapa: mapa ?? this.last?.mapa };
    }
    const mapa = this.last.mapa;
    return mapa && now - mapa.geradoEm <= MAX_IDADE_PONTE_MS ? mapa.porCli : new Map();
  }
}

export interface OrigemDoAgente {
  origin: AgentOrigin;
  /** `local_<uuid>`: só para agente do app desktop cuja sessão o mapa casou. */
  appSessionId?: string;
}

/** Selo de origem do registro de sessões (`entrypoint`, `kind`) e, para o app, o id que a ponte resolveu. */
export function origemDoAgente(registro: { entrypoint?: string; kind?: string }, appSessionId?: string): OrigemDoAgente | undefined {
  const { entrypoint, kind } = registro;
  if (entrypoint === 'claude-desktop') return appSessionId ? { origin: 'app desktop', appSessionId } : { origin: 'app desktop' };
  if (kind === 'bg' || kind === 'background') return { origin: 'segundo plano' };
  if (entrypoint === 'cli') return { origin: 'terminal' };
  if (entrypoint === 'sdk-py' || entrypoint === 'sdk-cli') return { origin: 'sdk' };
  return undefined;
}
