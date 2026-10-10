// Atualiza o Expediente num comando só (`npm run atualizar`): puxa o repositório, instala as dependências e reinstala o
// mod em cada conta (cópia fixa + claude plugin, o mesmo `npm run instalar`). Repassa as opções ao instalar
// (ex.: npm run atualizar -- --com-permissoes). Não reinicia o servidor: o fim diz como.
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export interface Step {
  cmd: string;
  args: string[];
  label: string;
  /** Captura a saída em vez de mostrá-la. */
  capture?: boolean;
}

export type StepRunner = (step: Step, cwd: string) => { code: number | null; stdout: string };

export function makeStepRunner(): StepRunner {
  return (step, cwd) => {
    const r = spawnSync(step.cmd, step.args, { cwd, encoding: 'utf8', stdio: step.capture ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'] });
    return { code: r.status, stdout: (r.stdout ?? '').trim() };
  };
}

export function updateSteps(installArgs: string[]): Step[] {
  return [
    { cmd: 'git', args: ['pull', '--ff-only'], label: 'git pull --ff-only' },
    { cmd: 'npm', args: ['install'], label: 'npm install' },
    { cmd: 'npm', args: ['run', 'instalar', ...(installArgs.length ? ['--', ...installArgs] : [])], label: 'npm run instalar' },
  ];
}

/** Roda os passos em ordem; para no primeiro que falhar. Devolve o código de saída. */
export function atualizar(installArgs: string[], root: string, run: StepRunner, out: (line: string) => void): number {
  const dirty = run({ cmd: 'git', args: ['status', '--porcelain', '--untracked-files=no'], label: 'git status', capture: true }, root);
  if (dirty.code !== 0 || dirty.stdout) {
    out('O checkout tem alterações não commitadas nos arquivos versionados (ou não é um repositório git); commite ou guarde antes de atualizar.');
    return 1;
  }
  for (const step of updateSteps(installArgs)) {
    out(`> ${step.label}`);
    const r = run(step, root);
    if (r.code !== 0) {
      out(`Parei em "${step.label}" (saiu com ${r.code ?? 'erro'}); o que vem depois não rodou.`);
      return 1;
    }
  }
  out('');
  out('Atualizado. Reinicie o servidor para usar a versão nova: npm run docker:up (ou npm run build && npm start).');
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = atualizar(process.argv.slice(2), ROOT, makeStepRunner(), (l) => console.log(l));
}
