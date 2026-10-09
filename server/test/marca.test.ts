import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const gerador = async () => (await import(join(ROOT, 'scripts/gerar-marca.mjs'))) as {
  gerarMarca: (tema: unknown) => Map<string, Buffer>;
  linhasDoLetreiro: () => string[];
};
const tema = () => JSON.parse(readFileSync(join(ROOT, 'client/public/temas/padrao/tema.json'), 'utf8'));
const tamanho = (b: Buffer) => [b.readUInt32BE(16), b.readUInt32BE(20)];

describe('marca gerada por script', () => {
  it('logo e placa têm os tamanhos que o tema padrão declara', async () => {
    const { marca } = tema().decoracao;
    const arquivos = (await gerador()).gerarMarca(tema());
    expect(tamanho(arquivos.get(`client/public/temas/padrao/${marca.logo.arquivo}`)!)).toEqual([marca.logo.largura, marca.logo.altura]);
    expect(tamanho(arquivos.get(`client/public/temas/padrao/${marca.placa.arquivo}`)!)).toEqual([marca.placa.largura, marca.placa.altura]);
  });

  it('os PNG versionados são exatamente a saída do script', async () => {
    for (const [rel, png] of (await gerador()).gerarMarca(tema())) {
      expect(readFileSync(join(ROOT, rel)).equals(png), rel).toBe(true);
    }
  });

  it('a mesma entrada dá os mesmos bytes', async () => {
    const g = await gerador();
    const a = g.gerarMarca(tema());
    const b = g.gerarMarca(tema());
    for (const [rel, png] of a) expect(b.get(rel)!.equals(png), rel).toBe(true);
  });

  it('as cores seguem a paleta do tema: trocar marca.simbolo muda o logo', async () => {
    const t = tema();
    t.paleta.marca.simbolo[2] = '#00ff00';
    const g = await gerador();
    const logo = 'client/public/temas/padrao/brand/logo-mark.png';
    expect(g.gerarMarca(t).get(logo)!.equals(g.gerarMarca(tema()).get(logo)!)).toBe(false);
  });

  it('o letreiro em pixels da UI é o que o script desenha', async () => {
    const fonte = readFileSync(join(ROOT, 'client/src/ui/icons.ts'), 'utf8');
    const bloco = /export const WORDMARK_ROWS = \[([\s\S]*?)\] as const;/.exec(fonte)![1];
    const linhas = [...bloco.matchAll(/'([.cts]+)'/g)].map((m) => m[1]);
    expect(linhas).toEqual((await gerador()).linhasDoLetreiro());
  });
});
