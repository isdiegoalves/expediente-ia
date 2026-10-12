import { describe, expect, it } from 'vitest';
import { type EstadoDoToken, textoDoAviso } from './token-aviso';

const base: EstadoDoToken = { mock: false, carregado: true, paginaTemToken: false, endereco: '127.0.0.1:4848', servidorSemToken: null };

describe('aviso das ações bloqueadas', () => {
  it('?mock=1 não depende de token: nunca avisa', () => {
    for (const paginaTemToken of [true, false]) for (const servidorSemToken of [null, 'sumiu']) expect(textoDoAviso({ ...base, mock: true, paginaTemToken, servidorSemToken })).toBeNull();
  });

  it('antes de a chave guardada ser lida e de o bilhete da URL ser trocado não há o que avisar', () => {
    expect(textoDoAviso({ ...base, carregado: false })).toBeNull();
  });

  it('página com a chave e servidor com token: nada a avisar', () => {
    expect(textoDoAviso({ ...base, paginaTemToken: true })).toBeNull();
  });

  it('página sem a chave: diz o que fica bloqueado e os dois jeitos de abrir autorizado, em passos', () => {
    const t = textoDoAviso(base)!;
    expect(t).toContain('bloqueadas');
    expect(t).toContain('/escritorio');
    expect(t).toContain('"Abrir o escritório"');
    expect(t).toContain('npm run abrir');
    expect(t).toMatch(/^1\. /m);
    expect(t).toMatch(/^2\. /m);
    expect(t).not.toContain('Você abriu por');
  });

  it('página aberta por outro endereço (localhost, expediente.localhost): explica que a autorização vale só em http://127.0.0.1', () => {
    for (const endereco of ['localhost:4848', 'expediente.localhost', '127.0.0.2:4848']) {
      const t = textoDoAviso({ ...base, endereco })!;
      expect(t).toContain(`Você abriu por ${endereco}`);
      expect(t).toContain('http://127.0.0.1');
    }
  });

  it('servidor sem token: mostra o motivo e manda subir o servidor de novo, mesmo com a chave na página', () => {
    const t = textoDoAviso({ ...base, paginaTemToken: true, servidorSemToken: 'o arquivo do token não existe ou não pode ser lido' })!;
    expect(t).toContain('o arquivo do token não existe');
    expect(t).toContain('npm run docker:up');
    expect(t).toContain('npm run abrir');
  });
});
