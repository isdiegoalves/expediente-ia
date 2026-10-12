import { describe, expect, it } from 'vitest';
import { textoDoAviso } from './token-aviso';

describe('aviso das ações bloqueadas', () => {
  it('?mock=1 não depende de token: nunca avisa', () => {
    for (const paginaTemToken of [true, false]) for (const servidorSemToken of [null, 'sumiu']) expect(textoDoAviso({ mock: true, paginaTemToken, servidorSemToken })).toBeNull();
  });

  it('página com token e servidor com token: nada a avisar', () => {
    expect(textoDoAviso({ mock: false, paginaTemToken: true, servidorSemToken: null })).toBeNull();
  });

  it('página sem token: diz o que fica bloqueado e os dois jeitos de abrir autorizado, em passos', () => {
    const t = textoDoAviso({ mock: false, paginaTemToken: false, servidorSemToken: null })!;
    expect(t).toContain('bloqueadas');
    expect(t).toContain('/escritorio');
    expect(t).toContain('"Abrir o escritório"');
    expect(t).toContain('npm run abrir');
    expect(t).toMatch(/^1\. /m);
    expect(t).toMatch(/^2\. /m);
  });

  it('servidor sem token: mostra o motivo e manda subir o servidor de novo, mesmo com token na página', () => {
    const t = textoDoAviso({ mock: false, paginaTemToken: true, servidorSemToken: 'o arquivo do token não existe ou não pode ser lido' })!;
    expect(t).toContain('o arquivo do token não existe');
    expect(t).toContain('npm run docker:up');
    expect(t).toContain('npm run abrir');
  });
});
