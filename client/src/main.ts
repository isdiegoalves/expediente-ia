// Ponto de entrada do cliente: tema -> store (dados) -> mundo (canvas) -> UI (painéis).
import { OfficeStore } from './net/store';
import { carregarTema, tema } from './tema';
import { aplicarFonte, aplicarPaleta } from './tema/aplicar';
import { migrateLegacyKeys, safeLocalStorage } from './ui/prefs';

// Antes de tudo: o mundo (carteiras) e a UI (preferências) leem o localStorage ao serem criados.
migrateLegacyKeys(safeLocalStorage());

void (async () => {
  const { aviso } = await carregarTema();
  aplicarPaleta(tema());
  // O mundo e a UI leem o tema ao serem importados, por isso só entram depois de ele estar definido.
  const [{ createWorld }, { createUI }] = await Promise.all([import('./world'), import('./ui')]);
  const params = new URLSearchParams(location.search);
  const store = new OfficeStore({ mock: params.has('mock') });
  const world = createWorld(document.getElementById('world') as HTMLCanvasElement, store);
  const ui = document.getElementById('ui') as HTMLElement;
  createUI(ui, store, world, aviso);
  void aplicarFonte(tema(), ui);
  store.connect();

  // Facilita a depuração pelo console do navegador.
  Object.assign(window, { expediente: { store, world } });
})();
