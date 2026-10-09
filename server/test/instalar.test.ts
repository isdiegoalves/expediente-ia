// Instalador do mod (scripts/instalar.ts): o comando inteiro contra um CLI FALSO do Claude Code, com HOME e contas
// FALSOS em pastas temporárias (nunca chama o `claude` de verdade nem toca em ~/.claude*), e a trava estática de
// que nenhum código do repositório grava em settings.json.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  installDir,
  makeGitRunner,
  MOD_PLUGIN,
  parseArgs,
  PERMISSIONS_PLUGIN,
  run,
  versionAtLeast,
  type ClaudeResult,
  type ClaudeRunner,
  type RunOptions,
} from '../../scripts/instalar';
import { tempDir } from './fixtures';

interface FakeAccount {
  /** Marketplaces por nome → pasta. */
  marketplaces: Map<string, string>;
  plugins: Map<string, { version: string; enabled: boolean }>;
}

class FakeClaude {
  version = '2.1.293 (Claude Code)';
  /** Versão dos manifestos em mod/ (o que install/update registram). */
  folderVersion = '0.2.0';
  missing = false;
  invalid = false;
  fail?: (args: string[]) => boolean;
  calls: Array<{ args: string[]; configDir: string }> = [];
  accounts = new Map<string, FakeAccount>();

  constructor(private home: string) {}

  account(configDir: string): FakeAccount {
    let a = this.accounts.get(configDir);
    if (!a) this.accounts.set(configDir, (a = { marketplaces: new Map(), plugins: new Map() }));
    return a;
  }

  get mutating(): string[] {
    return this.calls.filter((c) => !c.args.includes('--json') && c.args[0] !== '--version').map((c) => c.args.join(' '));
  }

  runner: ClaudeRunner = (args, env): ClaudeResult => {
    const configDir = env.CLAUDE_CONFIG_DIR ?? join(this.home, '.claude');
    this.calls.push({ args, configDir });
    if (this.missing) return { code: null, stdout: '', stderr: '', error: 'o comando "claude" não foi encontrado no PATH' };
    if (this.fail?.(args)) return { code: 1, stdout: '', stderr: '✘ Failed: boom\n' };
    const ok = (stdout = 'ok\n'): ClaudeResult => ({ code: 0, stdout, stderr: '' });
    const no = (stderr: string): ClaudeResult => ({ code: 1, stdout: '', stderr });
    const a = this.account(configDir);
    const cmd = args.join(' ');
    if (cmd === '--version') return ok(`${this.version}\n`);
    if (args[1] === 'validate') return this.invalid ? no('✘ Validation failed\n') : ok('✔ Validation passed\n');
    if (cmd === 'plugin marketplace list --json') {
      return ok(JSON.stringify([...a.marketplaces].map(([name, path]) => ({ name, source: 'directory', path, installLocation: path }))));
    }
    if (cmd === 'plugin list --json') {
      return ok(
        JSON.stringify(
          [...a.plugins].map(([id, p]) => ({ id, version: p.version, scope: 'user', enabled: p.enabled, installPath: '/cache', readFromFolder: `${a.marketplaces.get(id.split('@')[1])}/mod`, folderVersion: this.folderVersion })),
        ),
      );
    }
    const [, sub, third, fourth] = args;
    if (sub === 'marketplace') {
      if (third === 'add') {
        // Como o de verdade: o nome vem do manifesto da pasta (o mesmo nome só troca a origem).
        let name: string | undefined;
        try {
          name = (JSON.parse(readFileSync(join(fourth, '.claude-plugin', 'marketplace.json'), 'utf8')) as { name?: string }).name;
        } catch {
          name = undefined;
        }
        if (!name) return no(`✘ No marketplace.json in ${fourth}\n`);
        a.marketplaces.set(name, fourth);
        return ok(`✔ Successfully added marketplace: ${name}\n`);
      }
      if (!a.marketplaces.has(fourth)) return no(`✘ Marketplace '${fourth}' not found\n`);
      if (third === 'update') return ok();
      if (third === 'remove') {
        // Tirar o marketplace leva junto os plugins que vieram dele.
        a.marketplaces.delete(fourth);
        for (const id of [...a.plugins.keys()]) if (id.endsWith(`@${fourth}`)) a.plugins.delete(id);
        return ok();
      }
    }
    if (sub === 'install') {
      if (!a.marketplaces.has(third.split('@')[1])) return no(`✘ Plugin "${third}" not found in any marketplace\n`);
      a.plugins.set(third, { version: this.folderVersion, enabled: true });
      return ok();
    }
    const p = a.plugins.get(third);
    if (!p) return no(`✘ Plugin "${third}" not found in installed plugins\n`);
    if (sub === 'enable') p.enabled = true;
    else if (sub === 'update') p.version = this.folderVersion;
    else if (sub === 'uninstall') a.plugins.delete(third);
    else return no(`comando desconhecido: ${cmd}`);
    return ok();
  };
}

describe('instalar.ts (CLI falso, HOME falso)', () => {
  let tmp: ReturnType<typeof tempDir>;
  let home: string;
  let root: string;
  let usageDir: string;
  let out: string[];
  let fake: FakeClaude;
  const settingsDoDono = `${JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'say pronto' }] }] } }, null, 2)}\n`;

  beforeEach(() => {
    tmp = tempDir();
    home = join(tmp.dir, 'home');
    root = join(tmp.dir, 'expediente');
    usageDir = join(tmp.dir, 'usage');
    out = [];
    fake = new FakeClaude(home);
    mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
    mkdirSync(join(home, '.claude-conta2', 'sessions'), { recursive: true });
    mkdirSync(join(root, '.claude-plugin'), { recursive: true });
    writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), '{"name":"expediente","plugins":[]}');
    writeFileSync(join(root, 'package.json'), '{"version":"0.2.0"}\n');
    git(root, 'init', '-q');
    commit('primeiro');
    writeFileSync(join(home, '.claude', 'settings.json'), settingsDoDono);
  });
  afterEach(() => tmp.cleanup());

  const git = (cwd: string, ...args: string[]) => {
    const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const commit = (msg: string) => {
    git(root, 'add', '-A');
    git(root, 'commit', '-q', '-m', msg);
    return git(root, 'rev-parse', 'HEAD');
  };
  const copia = () => installDir(home);

  const exec = (command: RunOptions['command'], extra: Partial<RunOptions> = {}) =>
    run(
      { command, dryRun: false, permissions: false, accounts: [], ...extra },
      {
        env: { HOME: home, PATH: '/usr/bin', EXPEDIENTE_USAGE_DIR: usageDir, CLAUDE_CONFIG_DIR: join(home, '.claude-conta2') },
        home,
        now: new Date(2026, 9, 9, 9, 30, 0),
        root,
        git: makeGitRunner(),
        claude: fake.runner,
        out: (l) => out.push(l),
        health: async () => undefined,
      },
    );
  const installed = (acc: string) => Object.fromEntries(fake.account(join(home, acc)).plugins);

  it('só chama claude plugin e nunca grava settings.json', async () => {
    const antes = readFileSync(join(home, '.claude', 'settings.json'), 'utf8');
    const arquivosAntes = readdirSync(join(home, '.claude')).sort();
    expect(await exec('install', { permissions: true })).toBe(0);
    expect(await exec('status')).toBe(0);
    expect(await exec('uninstall')).toBe(0);
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const c of fake.calls) expect(c.args[0] === '--version' || c.args[0] === 'plugin', c.args.join(' ')).toBe(true);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe(antes);
    expect(readdirSync(join(home, '.claude')).sort()).toEqual(arquivosAntes);
    expect(existsSync(join(home, '.claude-conta2', 'settings.json'))).toBe(false);
  });

  it('instala só o mod por padrão, em cada conta com o seu CLAUDE_CONFIG_DIR; de novo = nada a fazer', async () => {
    expect(await exec('install')).toBe(0);
    for (const acc of ['.claude', '.claude-conta2']) {
      expect(Object.fromEntries(fake.account(join(home, acc)).marketplaces)).toEqual({ expediente: copia() });
      expect(installed(acc)).toEqual({ [MOD_PLUGIN]: { version: '0.2.0', enabled: true } });
    }
    expect(fake.accounts.size).toBe(2);
    expect(fake.calls.filter((c) => c.args[1] === 'install').map((c) => c.configDir)).toEqual([join(home, '.claude'), join(home, '.claude-conta2')]);
    expect(existsSync(usageDir)).toBe(true);
    expect(out.join('\n')).toContain('/reload-plugins');
    fake.calls = [];
    expect(await exec('install')).toBe(0);
    expect(fake.mutating).toEqual([`plugin validate ${copia()} --strict`, 'plugin marketplace update expediente', 'plugin marketplace update expediente']);
  });

  it('--com-permissoes instala também o expediente-permissoes', async () => {
    expect(await exec('install', { permissions: true, accounts: [join(home, '.claude')] })).toBe(0);
    expect(installed('.claude')).toEqual({
      [MOD_PLUGIN]: { version: '0.2.0', enabled: true },
      [PERMISSIONS_PLUGIN]: { version: '0.2.0', enabled: true },
    });
    expect(fake.calls.filter((c) => c.args[0] === 'plugin' && c.args[1] !== 'validate' && c.configDir === join(home, '.claude-conta2'))).toEqual([]);
  });

  it('recusa expediente-permissoes com habblaud-permissoes ativo', async () => {
    const conta = fake.account(join(home, '.claude'));
    conta.marketplaces.set('habblaud', '/habblaud');
    conta.plugins.set('habblaud-permissoes@habblaud', { version: '1.0.0', enabled: true });
    expect(await exec('install', { permissions: true })).toBe(1);
    expect(installed('.claude')).toEqual({ 'habblaud-permissoes@habblaud': { version: '1.0.0', enabled: true }, [MOD_PLUGIN]: { version: '0.2.0', enabled: true } });
    expect(out.join('\n')).toContain('expediente-permissoes recusado: habblaud-permissoes@habblaud está ativo');
    expect(installed('.claude-conta2')).toEqual({ [MOD_PLUGIN]: { version: '0.2.0', enabled: true }, [PERMISSIONS_PLUGIN]: { version: '0.2.0', enabled: true } });
  });

  it('habblaud-permissoes desligado não impede o expediente-permissoes', async () => {
    const conta = fake.account(join(home, '.claude'));
    conta.marketplaces.set('habblaud', '/habblaud');
    conta.plugins.set('habblaud-permissoes@habblaud', { version: '1.0.0', enabled: false });
    expect(await exec('install', { permissions: true, accounts: [join(home, '.claude')] })).toBe(0);
    expect(installed('.claude')[PERMISSIONS_PLUGIN]).toBeDefined();
  });

  it('nunca chama uninstall de plugin do habblaud', async () => {
    for (const acc of ['.claude', '.claude-conta2']) {
      const conta = fake.account(join(home, acc));
      conta.marketplaces.set('habblaud', '/habblaud');
      conta.plugins.set('habblaud@habblaud', { version: '1.0.0', enabled: true });
      conta.plugins.set('habblaud-permissoes@habblaud', { version: '1.0.0', enabled: true });
      conta.marketplaces.set('codetown', '/habblaud-antigo');
      conta.plugins.set('codetown@codetown', { version: '0.3.2', enabled: true });
      conta.plugins.set('codetown-permissoes@codetown', { version: '0.3.2', enabled: true });
    }
    await exec('install', { permissions: true });
    await exec('uninstall');
    const remocoes = fake.calls.filter((c) => c.args[1] === 'uninstall' || (c.args[1] === 'marketplace' && c.args[2] === 'remove'));
    expect(remocoes.length).toBeGreaterThan(0);
    for (const c of remocoes) expect(c.args.join(' ')).not.toMatch(/habblaud|codetown/i);
    for (const acc of ['.claude', '.claude-conta2']) {
      expect(installed(acc)['habblaud@habblaud']).toBeDefined();
      expect(installed(acc)['habblaud-permissoes@habblaud']).toBeDefined();
      expect(installed(acc)['codetown@codetown']).toBeDefined();
      expect(installed(acc)['codetown-permissoes@codetown']).toBeDefined();
      expect(fake.account(join(home, acc)).marketplaces.has('codetown')).toBe(true);
    }
  });

  it('Claude Code abaixo da versão mínima: recusa, sem cair em outro jeito e sem tocar em nada', async () => {
    fake.version = '2.1.286 (Claude Code)';
    expect(await exec('install')).toBe(1);
    const text = out.join('\n');
    expect(text).toContain('precisa do Claude Code 2.1.287 ou mais novo, e este é o 2.1.286');
    expect(text).not.toMatch(/usage:install|hooks:install/);
    expect(fake.mutating).toEqual([]);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toBe(settingsDoDono);
    expect(existsSync(usageDir)).toBe(false);
  });

  it('versão ilegível: recusa em vez de seguir às cegas', async () => {
    fake.version = 'banana';
    expect(await exec('install')).toBe(1);
    expect(fake.mutating).toEqual([]);
  });

  it('claude plugin validate --strict reprovado: nenhuma conta é tocada', async () => {
    fake.invalid = true;
    expect(await exec('install')).toBe(1);
    expect(out.join('\n')).toContain('não passou em claude plugin validate --strict');
    expect(fake.mutating).toEqual([`plugin validate ${copia()} --strict`]);
    for (const acc of fake.accounts.values()) expect(acc.marketplaces.size + acc.plugins.size).toBe(0);
  });

  it('sem o claude no PATH: erro claro, nada alterado', async () => {
    fake.missing = true;
    expect(await exec('install')).toBe(1);
    expect(out.join('\n')).toContain('não foi encontrado no PATH');
    expect(existsSync(usageDir)).toBe(false);
  });

  it('--dry-run não instala nada', async () => {
    expect(await exec('install', { dryRun: true, permissions: true })).toBe(0);
    for (const acc of fake.accounts.values()) expect(acc.plugins.size).toBe(0);
    expect(existsSync(usageDir)).toBe(false);
  });

  it('uninstall tira os plugins e o marketplace do Expediente de cada conta', async () => {
    await exec('install', { permissions: true });
    expect(await exec('uninstall')).toBe(0);
    for (const acc of ['.claude', '.claude-conta2']) {
      expect(installed(acc)).toEqual({});
      expect(fake.account(join(home, acc)).marketplaces.size).toBe(0);
    }
  });

  it('status mostra marketplace e plugins por conta', async () => {
    await exec('install');
    out = [];
    expect(await exec('status')).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('marketplace expediente: cópia fixa');
    expect(text).toContain(`commit instalado: ${git(root, 'rev-parse', '--short', 'HEAD')}`);
    expect(text).toContain('expediente: instalado, ligado, versão 0.2.0');
    expect(text).toContain('expediente-permissoes: não instalado');
  });

  it('registra a cópia fixa, não o checkout, e mexer no checkout não muda a cópia', async () => {
    const instalado = git(root, 'rev-parse', 'HEAD');
    expect(await exec('install')).toBe(0);
    for (const acc of ['.claude', '.claude-conta2']) {
      const registrada = fake.account(join(home, acc)).marketplaces.get('expediente')!;
      expect(registrada).toBe(copia());
      expect(registrada).not.toBe(root);
    }
    expect(git(copia(), 'rev-parse', 'HEAD')).toBe(instalado);
    const manifestoAntes = readFileSync(join(copia(), '.claude-plugin', 'marketplace.json'), 'utf8');

    writeFileSync(join(root, '.claude-plugin', 'marketplace.json'), '{"name":"outro","plugins":[]}');
    commit('segundo');
    git(root, 'switch', '-q', '-c', 'outro-ramo');
    writeFileSync(join(root, 'package.json'), '{"version":"9.9.9"}\n');

    expect(git(copia(), 'rev-parse', 'HEAD')).toBe(instalado);
    expect(readFileSync(join(copia(), '.claude-plugin', 'marketplace.json'), 'utf8')).toBe(manifestoAntes);
    expect(readFileSync(join(copia(), 'package.json'), 'utf8')).toContain('0.2.0');
  });

  it('recusa checkout com alterações nos arquivos versionados, sem tocar em nada', async () => {
    writeFileSync(join(root, 'package.json'), '{"version":"0.2.1"}\n');
    expect(await exec('install')).toBe(1);
    expect(out.join('\n')).toContain('alterações não commitadas');
    expect(fake.mutating).toEqual([]);
    expect(existsSync(copia())).toBe(false);
  });

  it('--commit instala o commit pedido; instalar de novo atualiza a cópia de propósito', async () => {
    const primeiro = git(root, 'rev-parse', 'HEAD');
    writeFileSync(join(root, 'package.json'), '{"version":"0.3.0"}\n');
    const segundo = commit('segundo');
    expect(await exec('install', { commit: primeiro })).toBe(0);
    expect(git(copia(), 'rev-parse', 'HEAD')).toBe(primeiro);

    fake.folderVersion = '0.3.0';
    expect(await exec('install')).toBe(0);
    expect(git(copia(), 'rev-parse', 'HEAD')).toBe(segundo);
    expect(installed('.claude')[MOD_PLUGIN].version).toBe('0.3.0');
  });

  it('--dry-run não cria a cópia', async () => {
    expect(await exec('install', { dryRun: true })).toBe(0);
    expect(existsSync(copia())).toBe(false);
  });

  it('uninstall também remove a cópia fixa', async () => {
    await exec('install');
    expect(existsSync(copia())).toBe(true);
    expect(await exec('uninstall')).toBe(0);
    expect(existsSync(copia())).toBe(false);
    expect(git(root, 'worktree', 'list')).not.toContain('mod-instalado');
  });
});

describe('instalar.ts (puras)', () => {
  it('parseArgs: permissões só com --com-permissoes', () => {
    expect(parseArgs(['install'])).toMatchObject({ command: 'install', permissions: false });
    expect(parseArgs(['install', '--com-permissoes'])).toMatchObject({ permissions: true });
    expect(() => parseArgs(['install', '--sem-permissoes'])).toThrow(/opção desconhecida/);
    expect(parseArgs(['install', '--commit', 'abc'])).toMatchObject({ commit: 'abc' });
    expect(() => parseArgs(['install', '--commit'])).toThrow(/--commit/);
    expect(parseArgs(['-h'])).toBe('help');
  });

  it('versionAtLeast', () => {
    expect(versionAtLeast('2.1.287', '2.1.287')).toBe(true);
    expect(versionAtLeast('2.1.286', '2.1.287')).toBe(false);
  });
});

describe('nenhum código do repositório grava em settings.json', () => {
  const RAIZ = join(__dirname, '..', '..');
  const arquivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((nome) => {
      if (nome === 'node_modules' || nome === 'test') return [];
      const p = join(dir, nome);
      return statSync(p).isDirectory() ? arquivos(p) : /\.(ts|mjs|js|cjs)$/.test(nome) ? [p] : [];
    });
  const ALVO = /settings(\.local)?\.json/;
  const ESCRITA = /\b(writeFile|writeFileSync|appendFile|appendFileSync|rename|renameSync|copyFile|copyFileSync|cp|cpSync|truncate|truncateSync|createWriteStream|writeSettings)\b/;

  it('em scripts/ e server/ (fora dos testes), nenhum arquivo cita settings.json junto de uma escrita em disco', () => {
    const culpados = [...arquivos(join(RAIZ, 'scripts')), ...arquivos(join(RAIZ, 'server'))]
      .filter((f) => {
        const texto = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        return ALVO.test(texto) && ESCRITA.test(texto);
      })
      .map((f) => relative(RAIZ, f));
    expect(culpados).toEqual([]);
  });
});
