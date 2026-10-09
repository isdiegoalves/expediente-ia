import { describe, expect, it } from 'vitest';
import { copiadoTexto, ordemTentada } from './ir';

describe('ir', () => {
  it('copiadoTexto: repete o rótulo da cópia por fork só quando o servidor o manda', () => {
    expect(copiadoTexto({ aviso: 'cria uma cópia, não responde à sessão original' })).toBe('Comando copiado: cria uma cópia, não responde à sessão original.');
    expect(copiadoTexto({})).toBe('Comando copiado.');
  });

  it('ordemTentada: o link do app só entra para o agente do app', () => {
    expect(ordemTentada({ origin: 'app desktop' })).toContain('link do app');
    expect(ordemTentada({ origin: 'terminal' })).not.toContain('link do app');
    expect(ordemTentada({})).not.toContain('link do app');
  });
});
