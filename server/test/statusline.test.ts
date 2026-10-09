// Tap de statusline (scripts/statusline-tap.mjs, testado como processo de verdade), com HOME e config dirs FALSOS
// em pastas temporárias.
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tempDir } from './fixtures';

const TAP = resolve(__dirname, '../../scripts/statusline-tap.mjs');
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
const NOW_S = Math.floor(Date.now() / 1000);

function statusJson(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    hook_event_name: 'Status',
    session_id: 'sess-1',
    transcript_path: '/fake/home/.claude-conta2/projects/-x-proj/sess-1.jsonl',
    cwd: '/x/proj',
    model: { id: 'claude-teste', display_name: 'Teste' },
    workspace: { current_dir: '/x/proj', project_dir: '/x/proj' },
    cost: { total_cost_usd: 1.23 },
    rate_limits: {
      five_hour: { used_percentage: 42.5, resets_at: NOW_S + 3_600 },
      seven_day: { used_percentage: 15, resets_at: NOW_S + 86_400 },
    },
    ...over,
  });
}

describe('statusline-tap.mjs', () => {
  let tmp: ReturnType<typeof tempDir>;
  let env: NodeJS.ProcessEnv;
  let usageDir: string;

  beforeEach(() => {
    tmp = tempDir();
    usageDir = join(tmp.dir, 'usage');
    // HOME falso e pasta de uso explícita: o teste nunca toca em ~/.expediente nem em ~/.claude*.
    env = { PATH: process.env.PATH, HOME: join(tmp.dir, 'home'), EXPEDIENTE_USAGE_DIR: usageDir };
  });
  afterEach(() => tmp.cleanup());

  const tap = (args: string[], input: string, extraEnv: NodeJS.ProcessEnv = {}) =>
    spawnSync(process.execPath, [TAP, ...args], { input, env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10_000 });

  it('repassa o stdin ao comando original e grava SÓ os limites, de forma atômica e com modo 600', () => {
    const input = statusJson();
    const r = tap(['--', 'cat'], input);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(input);
    const files = readdirSync(usageDir);
    expect(files).toEqual(['.claude-conta2.json']);
    const file = join(usageDir, files[0]);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const rec = JSON.parse(readFileSync(file, 'utf8'));
    expect(Object.keys(rec).sort()).toEqual(['accountId', 'configDir', 'fetchedAt', 'five_hour', 'seven_day']);
    expect(rec).toMatchObject({
      accountId: '.claude-conta2',
      configDir: '/fake/home/.claude-conta2',
      five_hour: { utilization: 42.5, resets_at: NOW_S + 3_600 },
      seven_day: { utilization: 15, resets_at: NOW_S + 86_400 },
    });
    expect(Math.abs(rec.fetchedAt - Date.now())).toBeLessThan(30_000);
    // Nada do resto do stdin (custo, sessão, cwd...).
    const raw = readFileSync(file, 'utf8');
    for (const leak of ['sess-1', 'total_cost_usd', '/x/proj', 'claude-teste']) expect(raw).not.toContain(leak);
  });

  it('sai com o código do comando original; comandos com pipe e aspas continuam valendo', () => {
    expect(tap(['--', 'exit', '7'], statusJson()).status).toBe(7);
    // Entre aspas simples, o shell tira as aspas e o tap recebe o comando inteiro como um único argumento.
    const complex = `printf '%s|' "a b" | tr a-z A-Z`;
    const viaShell = spawnSync('/bin/sh', ['-c', `"${process.execPath}" "${TAP}" -- ${shellQuote(complex)}`], {
      input: statusJson(),
      env,
      encoding: 'utf8',
    });
    expect(viaShell.status).toBe(0);
    expect(viaShell.stdout).toBe('A B|');
  });

  it('sem comando original: não imprime nada, mas captura', () => {
    const r = tap([], statusJson());
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
    expect(existsSync(join(usageDir, '.claude-conta2.json'))).toBe(true);
  });

  it('sem rate_limits, JSON inválido ou pasta de uso impossível: nunca atrapalha o statusline', () => {
    const noLimits = statusJson({ rate_limits: undefined });
    expect(tap(['--', 'cat'], noLimits).stdout).toBe(noLimits);
    expect(tap(['--', 'cat'], 'isto não é json').stdout).toBe('isto não é json');
    expect(existsSync(usageDir)).toBe(false);
    // EXPEDIENTE_USAGE_DIR aponta para um arquivo: a gravação falha em silêncio.
    writeFileSync(join(tmp.dir, 'arquivo'), 'x');
    const r = tap(['--', 'echo', 'ok'], statusJson(), { EXPEDIENTE_USAGE_DIR: join(tmp.dir, 'arquivo') });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('ok\n');
    expect(r.stderr).toBe('');
  });

  it('sem transcript_path: CLAUDE_CONFIG_DIR (primeiro da lista) e depois ~/.claude', () => {
    tap([], statusJson({ transcript_path: undefined }), { CLAUDE_CONFIG_DIR: '/outra/.claude-trabalho,/x' });
    expect(JSON.parse(readFileSync(join(usageDir, '.claude-trabalho.json'), 'utf8')).configDir).toBe('/outra/.claude-trabalho');
    tap([], statusJson({ transcript_path: undefined }));
    expect(JSON.parse(readFileSync(join(usageDir, '.claude.json'), 'utf8')).configDir).toBe(join(env.HOME!, '.claude'));
  });

  it('não regrava valores idênticos em menos de 10 s', () => {
    tap([], statusJson());
    const file = join(usageDir, '.claude-conta2.json');
    const first = JSON.parse(readFileSync(file, 'utf8')).fetchedAt;
    tap([], statusJson());
    expect(JSON.parse(readFileSync(file, 'utf8')).fetchedAt).toBe(first);
    tap([], statusJson({ rate_limits: { five_hour: { used_percentage: 43, resets_at: NOW_S + 3_600 } } }));
    const changed = JSON.parse(readFileSync(file, 'utf8'));
    expect(changed.five_hour.utilization).toBe(43);
    expect(changed.seven_day).toBeUndefined();
  });
});
