// Consulta a última release do Expediente no GitHub e grava ~/.expediente/host/versao.json, de onde o servidor
// (que não acessa a internet) tira o aviso de "nova versão". Roda no host, não no container; é opt-in.
//   npm run versao                    -> consulta e grava
//   npm run versao -- --saida <pasta> -> grava em outra pasta (testes e provas)
// Sem token, com tempo limite; se a consulta falhar o arquivo anterior fica como estava. O campo "origem",
// escrito por outra ferramenta do dono, é preservado.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { lerPublicada, type VersaoPublicada } from '../shared/versao';

export const REPOSITORIO = 'isdiegoalves/expediente-ia';
export const ARQUIVO = 'versao.json';
const TEMPO_LIMITE_MS = 10_000;

export interface VersaoArgs {
  saida: string;
  help: boolean;
}

export function parseVersaoArgs(argv: string[], home: string = homedir()): VersaoArgs {
  const args: VersaoArgs = { saida: join(home, '.expediente', 'host'), help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--help' || a === '-h') args.help = true;
    else if (a === '--saida') {
      const v = argv[++i];
      if (!v) throw new Error('--saida precisa de uma pasta');
      args.saida = resolve(v);
    } else throw new Error(`opção desconhecida: ${a}`);
  }
  return args;
}

/** Última release publicada (a API do GitHub ignora rascunhos e pré-lançamentos). */
export async function ultimaRelease(buscar: typeof fetch): Promise<VersaoPublicada> {
  const res = await buscar(`https://api.github.com/repos/${REPOSITORIO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'expediente-versao' },
    signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
  });
  if (!res.ok) throw new Error(res.status === 404 ? 'o repositório ainda não tem release publicada' : `o GitHub respondeu ${res.status}`);
  const corpo = (await res.json().catch(() => null)) as { tag_name?: unknown; published_at?: unknown; html_url?: unknown } | null;
  const release = lerPublicada({ ultima: corpo?.tag_name, publicadaEm: corpo?.published_at, url: corpo?.html_url });
  if (!release) throw new Error('resposta do GitHub fora do formato esperado (tag X.Y.Z, data e endereço https)');
  return release;
}

function origemAnterior(arquivo: string): unknown {
  try {
    const anterior = JSON.parse(readFileSync(arquivo, 'utf8')) as { origem?: unknown } | null;
    return anterior && typeof anterior === 'object' ? anterior.origem : undefined;
  } catch {
    return undefined;
  }
}

/** Grava por arquivo temporário e rename: o servidor nunca lê um arquivo pela metade. */
export function gravar(pasta: string, release: VersaoPublicada, agora: Date): string {
  mkdirSync(pasta, { recursive: true });
  const arquivo = join(pasta, ARQUIVO);
  const origem = origemAnterior(arquivo);
  const conteudo = {
    verificadoEm: agora.toISOString(),
    expediente: { ultima: release.versao, publicadaEm: release.publicadaEm, url: release.url },
    ...(origem === undefined ? {} : { origem }),
  };
  const temporario = join(pasta, `.${ARQUIVO}.${process.pid}.tmp`);
  try {
    writeFileSync(temporario, `${JSON.stringify(conteudo, null, 2)}\n`);
    renameSync(temporario, arquivo);
  } finally {
    rmSync(temporario, { force: true });
  }
  return arquivo;
}

export async function executar(args: VersaoArgs, buscar: typeof fetch = fetch, agora: () => Date = () => new Date()): Promise<number> {
  try {
    const release = await ultimaRelease(buscar);
    const arquivo = gravar(args.saida, release, agora());
    console.log(`Última release do Expediente: v${release.versao}, publicada em ${release.publicadaEm}.\nGravado em ${arquivo}`);
    return 0;
  } catch (err) {
    console.error(`✗ Não consegui verificar a versão: ${(err as Error).message}. O arquivo anterior, se havia, ficou como estava.`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let args: VersaoArgs;
  try {
    args = parseVersaoArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${(err as Error).message}`);
    process.exit(1);
  }
  if (args.help) console.log('Uso: npm run versao [-- --saida <pasta>]\nConsulta a última release do Expediente e grava versao.json na ponte do host.');
  else process.exit(await executar(args));
}
