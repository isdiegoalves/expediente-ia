import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type GitRunner = (args: string[], cwd: string) => { code: number | null; stdout: string; stderr: string };

const TAR_TIMEOUT_MS = 120_000;

const COMMIT_MARKER = '.expediente-commit';

/** Commit da cópia fixa (gravado na instalação), ou undefined se a cópia não existe. */
export function installedCommit(dir: string): string | undefined {
  try {
    return readFileSync(join(dir, COMMIT_MARKER), 'utf8').trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Exporta o commit para a cópia fixa, sem .git: monta numa pasta ao lado e troca por rename, então uma falha no meio
 * deixa a cópia anterior intacta. Uma cópia no formato antigo (git worktree) é substituída e o registro dela no
 * repositório é podado.
 */
export function syncCopy(git: GitRunner, root: string, dir: string, commit: string): string | undefined {
  const stage = `${dir}.novo`;
  const tarFile = `${dir}.tar`;
  const fail = (why: string) => {
    rmSync(stage, { recursive: true, force: true });
    rmSync(tarFile, { force: true });
    return `não consegui preparar a cópia fixa em ${dir} (${why})`;
  };
  try {
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage, { recursive: true });
    const ar = git(['archive', '--format=tar', `--output=${tarFile}`, commit], root);
    if (ar.code !== 0) return fail(ar.stderr || 'git archive falhou');
    const tar = spawnSync('tar', ['-xf', tarFile, '-C', stage], { encoding: 'utf8', timeout: TAR_TIMEOUT_MS });
    if (tar.status !== 0) return fail(tar.stderr || 'tar falhou');
    rmSync(tarFile, { force: true });
    writeFileSync(join(stage, COMMIT_MARKER), `${commit}\n`);
    const antiga = `${dir}.antiga`;
    rmSync(antiga, { recursive: true, force: true });
    if (existsSync(dir)) renameSync(dir, antiga);
    renameSync(stage, dir);
    rmSync(antiga, { recursive: true, force: true });
  } catch (err) {
    return fail((err as Error).message);
  }
  git(['worktree', 'prune'], root);
  return undefined;
}

/** Remove a cópia fixa (e, se era um worktree antigo, o registro dele no repositório). */
export function removeCopy(git: GitRunner, root: string, dir: string): string | undefined {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    return (err as Error).message;
  }
  git(['worktree', 'prune'], root);
  return undefined;
}
