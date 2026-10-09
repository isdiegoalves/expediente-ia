import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { medirContraste, paresFaltando, validar, type Tema } from '../../shared/tema/validar';

const ler = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const esquema = ler('../../shared/tema/tema.schema.json');
const padrao = (): Tema => ler('../../client/public/temas/padrao/tema.json');
const falhas = (t: unknown) => validar(esquema, t);

describe('tema padrão', () => {
  it('passa no schema sem falhas', () => {
    expect(falhas(padrao())).toEqual([]);
  });

  it('cumpre os 22 pares de contraste, o mais justo com 4,5:1 ou mais', () => {
    const { medidas, erros } = medirContraste(padrao());
    expect(medidas).toHaveLength(22);
    expect(erros).toEqual([]);
    const textoFraco = medidas.find((m) => m.par.startsWith('ui.textoFraco sobre ui.fundo '));
    expect(textoFraco?.razao).toBeGreaterThan(4.6);
  });
});

describe('tema é dado', () => {
  const com = (mexe: (t: Tema) => void) => {
    const t = padrao();
    mexe(t);
    return falhas(t);
  };

  it('recusa versão desconhecida', () => {
    expect(com((t) => ((t as { versao: number }).versao = 2))).not.toEqual([]);
  });

  it.each([
    ['URL', 'https://exemplo.com/a.png'],
    ['caminho com ..', '../fora.png'],
    ['SVG', 'brand/logo.svg'],
    ['caminho absoluto', '/etc/passwd.png'],
  ])('recusa %s em arquivo de imagem', (_nome, arquivo) => {
    expect(com((t) => (t.decoracao.marca.logo.arquivo = arquivo))).not.toEqual([]);
  });

  it.each(['<img src=x onerror=1>', 'a{color:red}', 'a`b', 'a\\b'])('recusa texto com marcação ou chaves: %s', (texto) => {
    expect(com((t) => (t.textos.status.ocioso = texto))).not.toEqual([]);
  });

  it.each(['red', 'url(x)', '#12345', 'rgb(1,2,3)', '#12345g'])('recusa cor fora do padrão hexadecimal: %s', (cor) => {
    expect(com((t) => (t.paleta.ui.texto = cor))).not.toEqual([]);
  });

  it('recusa campo não previsto e chave de protótipo', () => {
    expect(com((t) => ((t as unknown as Record<string, unknown>).css = 'x'))).not.toEqual([]);
    expect(falhas(JSON.parse('{"__proto__": {"x": 1}}'))).not.toEqual([]);
  });

  it('aceita URL só em origem.fontes[].referencia', () => {
    expect(com((t) => t.origem.fontes.push({ tipo: 'pagina', referencia: 'https://exemplo.com/marca' }))).toEqual([]);
    expect(com((t) => (t.origem.fontes[0].referencia = 'x<script>'))).not.toEqual([]);
  });

  it('recusa fonte com extensão ou licença fora da lista', () => {
    expect(com((t) => (t.tipografia.arquivo = 'fontes/a.exe'))).not.toEqual([]);
    expect(com((t) => (t.tipografia.licenca = 'proprietaria'))).not.toEqual([]);
  });
});

describe('contraste com alpha composto', () => {
  it('reprova texto fraco sobre o painel', () => {
    const t = padrao();
    t.paleta.ui.textoFraco = '#555a66';
    const { erros } = medirContraste(t);
    expect(erros.some((e) => e.includes('ui.textoFraco'))).toBe(true);
  });

  it('compõe o fundo translúcido sobre a cor de baixo: o mesmo par muda de resultado com `sobre`', () => {
    const t = padrao();
    t.paleta.ui.fundo = '#12151d80';
    const claro = medirContraste({ ...t, contraste: [{ texto: 'ui.textoMudo', fundo: 'ui.fundo', sobre: 'piso.azulejo.2', min: 4.5 }] });
    const escuro = medirContraste({ ...t, contraste: [{ texto: 'ui.textoMudo', fundo: 'ui.fundo', sobre: 'piso.rua.0', min: 4.5 }] });
    expect(claro.medidas[0].razao).toBeLessThan(escuro.medidas[0].razao);
  });

  it('exige `sobre` quando o fundo tem alpha', () => {
    const t = padrao();
    const { erros } = medirContraste({ ...t, contraste: [{ texto: 'ui.texto', fundo: 'ui.fundo', min: 4.5 }] });
    expect(erros[0]).toContain('sobre');
  });

  it('reprova caminho de cor que não existe', () => {
    const t = padrao();
    const { erros } = medirContraste({ ...t, contraste: [{ texto: 'ui.nada', fundo: 'ui.fundo', sobre: 'piso.azulejo.2', min: 4.5 }] });
    expect(erros).toHaveLength(1);
  });

  it('tema de marca não pode omitir pares do padrão nem baixar o mínimo', () => {
    const t = padrao();
    expect(paresFaltando(t, padrao())).toEqual([]);
    t.contraste = t.contraste.slice(1);
    expect(paresFaltando(t, padrao())).toHaveLength(1);
    const u = padrao();
    u.contraste[0].min = 3;
    expect(paresFaltando(u, padrao())).toHaveLength(1);
  });
});
