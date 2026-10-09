import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Tema } from '../../../shared/tema/validar';
import { TEMA_PADRAO } from './index';

afterEach(() => vi.resetModules());

/** Importa o tema de novo, define `mexe(tema)` como ativo e devolve os módulos que leem os textos ao serem importados. */
async function comTema(mexe: (t: Tema) => void) {
  vi.resetModules();
  const t = structuredClone(TEMA_PADRAO);
  mexe(t);
  const { definirTema } = await import('./index');
  definirTema(t, '/temas/teste/');
  return { model: await import('../ui/model'), overlay: await import('../world/render/overlay') };
}

describe('textos do tema', () => {
  it('o padrão mantém os rótulos de status e os nomes das áreas do núcleo', async () => {
    const { model, overlay } = await comTema(() => {});
    expect(model.STATUS_LABEL).toEqual({
      working: 'Trabalhando',
      waiting: 'Precisa de você',
      shell: 'Esperando o shell',
      idle: 'Ocioso',
      done: 'Concluído',
      offline: 'Saindo',
    });
    expect(overlay.CORE_NAMES).toEqual({ 'core:recepcao': 'Recepção', 'core:banheiros': 'Banheiros', 'core:copa': 'Copa', 'core:lounge': 'Lounge' });
  });

  it('rótulos de status e áreas trocam sem tocar no código', async () => {
    const { model, overlay } = await comTema((t) => {
      t.textos.status.esperando = 'Aguardando você';
      t.textos.status.saindo = 'Encerrando';
      t.textos.areasNucleo.copa = 'Cozinha';
      t.textos.areasNucleo.recepcao = 'Entrada';
    });
    expect(model.statusLabel('waiting')).toBe('Aguardando você');
    expect(model.statusLabel('offline')).toBe('Encerrando');
    expect(model.statusLabel('working')).toBe('Trabalhando');
    expect(overlay.CORE_NAMES['core:copa']).toBe('Cozinha');
    expect(overlay.CORE_NAMES['core:recepcao']).toBe('Entrada');
  });
});
