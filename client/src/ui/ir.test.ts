import { describe, expect, it } from 'vitest';
import { appRespondeu, copiadoTexto, ehLinkDaSessao, ordemTentada } from './ir';

describe('ir', () => {
  it('copiadoTexto: repete o rótulo da cópia por fork só quando o servidor o manda', () => {
    expect(copiadoTexto({ aviso: 'cria uma cópia, não responde à sessão original' })).toBe('Comando copiado: cria uma cópia, não responde à sessão original.');
    expect(copiadoTexto({})).toBe('Comando copiado.');
  });

  it('ordemTentada: o link do app só entra para o agente do app', () => {
    expect(ordemTentada({ origin: 'app desktop', links: [] })).toContain('indisponível');
    expect(ordemTentada({ origin: 'app desktop', links: [{ rotulo: 'x', href: 'claude://code/continue?session=local_ab-1' }] })).not.toContain('indisponível');
    expect(ordemTentada({ origin: 'terminal', links: [] })).not.toContain('link do app');
    expect(ordemTentada({ links: [] })).not.toContain('link do app');
  });

  it('ehLinkDaSessao: só claude://code/continue com id local_ do formato do app', () => {
    expect(ehLinkDaSessao('claude://code/continue?session=local_5e6f7a8b-aaaa')).toBe(true);
    expect(ehLinkDaSessao('claude://code/continue?session=last')).toBe(false);
    expect(ehLinkDaSessao('claude://code/continue?session=local_a&x=1')).toBe(false);
    expect(ehLinkDaSessao('claude://code/new?folder=%2Fp')).toBe(false);
    expect(ehLinkDaSessao('https://code/continue?session=local_a')).toBe(false);
  });

  it('appRespondeu: o app responde quando a página perdeu o foco ou ficou oculta', () => {
    expect(appRespondeu({ temFoco: false, visivel: true })).toBe(true);
    expect(appRespondeu({ temFoco: true, visivel: false })).toBe(true);
    expect(appRespondeu({ temFoco: true, visivel: true })).toBe(false);
  });
});
