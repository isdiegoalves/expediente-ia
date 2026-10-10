import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIMITE_AUSENCIA_MS } from '../../shared/resumo';
import { setQuiet } from '../log';
import { tempDir } from '../test/fixtures';
import { Presenca } from './resumo';

setQuiet(true);

let dir: string;
let cleanup: () => void;
let agora = 5_000_000;
const relogio = () => agora;

beforeEach(() => {
  const t = tempDir();
  dir = t.dir;
  cleanup = t.cleanup;
});
afterEach(() => cleanup());

describe('quando você saiu', () => {
  it('a última aba visível que some grava a saída; com outra aba visível, ninguém saiu', () => {
    const p = new Presenca(null, relogio);
    p.visivel('a');
    p.visivel('b');
    p.oculta('a');
    expect(p.ultimaSaida).toBeNull();
    agora += 1_000;
    p.oculta('b');
    expect(p.ultimaSaida).toBe(agora);
  });

  it('a saída marcada sobrevive ao reinício do servidor e a volta depois do limite pede o resumo', () => {
    const arquivo = join(dir, 'resumo.json');
    const antes = new Presenca(arquivo, relogio);
    antes.visivel('a');
    const saiu = agora;
    antes.oculta('a');
    expect(existsSync(arquivo)).toBe(true);

    agora += LIMITE_AUSENCIA_MS + 1;
    const depois = new Presenca(arquivo, relogio);
    depois.load();
    expect(depois.ultimaSaida).toBe(saiu);
    expect(depois.visivel('nova')).toEqual({ saiuEm: saiu, mostrar: true });
  });

  it('voltar antes do limite não abre o resumo, mas a saída continua marcada', () => {
    const p = new Presenca(join(dir, 'resumo.json'), relogio);
    p.visivel('a');
    const saiu = agora;
    p.oculta('a');
    agora += LIMITE_AUSENCIA_MS - 1;
    expect(p.visivel('a')).toEqual({ saiuEm: saiu, mostrar: false });
  });

  it('só a primeira chamada depois da volta pede o resumo, e o arquivo guarda que você voltou', () => {
    const arquivo = join(dir, 'resumo.json');
    const p = new Presenca(arquivo, relogio);
    p.visivel('a');
    p.oculta('a');
    agora += LIMITE_AUSENCIA_MS;
    expect(p.visivel('a').mostrar).toBe(true);
    expect(p.visivel('a').mostrar).toBe(false);
    expect(JSON.parse(readFileSync(arquivo, 'utf8'))).toMatchObject({ fora: false });
  });

  it('reiniciar com você presente não conta como volta', () => {
    const arquivo = join(dir, 'resumo.json');
    const antes = new Presenca(arquivo, relogio);
    antes.visivel('a');
    agora += 10 * LIMITE_AUSENCIA_MS;
    const depois = new Presenca(arquivo, relogio);
    depois.load();
    expect(depois.visivel('a').mostrar).toBe(false);
  });

  it('arquivo ilegível começa do zero', () => {
    const arquivo = join(dir, 'resumo.json');
    writeFileSync(arquivo, '{"saiuEm": ');
    const p = new Presenca(arquivo, relogio);
    p.load();
    expect(p.ultimaSaida).toBeNull();
    expect(p.visivel('a').mostrar).toBe(false);
  });
});
