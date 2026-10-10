import { describe, expect, it } from 'vitest';
import { atualizar, type Step, type StepRunner } from '../../scripts/atualizar';

function harness(falha?: string, sujo = false) {
  const rodou: string[] = [];
  const runner: StepRunner = (step: Step) => {
    rodou.push(step.label);
    if (step.label === 'git status') return { code: 0, stdout: sujo ? ' M package.json' : '' };
    return { code: step.label === falha ? 1 : 0, stdout: '' };
  };
  const out: string[] = [];
  return { rodou, runner, out, say: (l: string) => out.push(l) };
}

describe('atualizar.ts', () => {
  it('um comando: puxa, instala as dependências e reinstala o mod, nessa ordem', () => {
    const h = harness();
    expect(atualizar([], '/repo', h.runner, h.say)).toBe(0);
    expect(h.rodou).toEqual(['git status', 'git pull --ff-only', 'npm install', 'npm run instalar']);
    expect(h.out.join('\n')).toContain('Reinicie o servidor');
  });

  it('repassa as opções ao instalar', () => {
    const passos: string[][] = [];
    const runner: StepRunner = (step) => {
      passos.push([step.cmd, ...step.args]);
      return { code: 0, stdout: '' };
    };
    atualizar(['--com-permissoes'], '/repo', runner, () => {});
    expect(passos.at(-1)).toEqual(['npm', 'run', 'instalar', '--', '--com-permissoes']);
  });

  it('para no primeiro passo que falha e não instala o mod', () => {
    const h = harness('git pull --ff-only');
    expect(atualizar([], '/repo', h.runner, h.say)).toBe(1);
    expect(h.rodou).toEqual(['git status', 'git pull --ff-only']);
    expect(h.out.join('\n')).toContain('git pull --ff-only');
  });

  it('recusa checkout com alterações, sem puxar nada', () => {
    const h = harness(undefined, true);
    expect(atualizar([], '/repo', h.runner, h.say)).toBe(1);
    expect(h.rodou).toEqual(['git status']);
  });
});
