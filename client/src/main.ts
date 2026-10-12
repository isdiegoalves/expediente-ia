// Ponto de entrada do cliente: tema -> store (dados) -> mundo (canvas) -> UI (painéis).
import { OfficeStore } from './net/store';
import { receberTokenDaUrl } from './net/token';
import { carregarTema, tema } from './tema';
import { aplicarFonte, aplicarPaleta } from './tema/aplicar';
import { faixaDePrevia } from './ui/previa';
import { migrateLegacyKeys, safeLocalStorage } from './ui/prefs';

// Antes de tudo: o mundo (carteiras) e a UI (preferências) leem o localStorage ao serem criados.
migrateLegacyKeys(safeLocalStorage());
// O bilhete chega no fragmento da URL (o navegador não o manda ao servidor): vira a chave do token e some da barra de endereço.
void receberTokenDaUrl(location, history);

void (async () => {
  const { aviso, previa, chave } = await carregarTema();
  aplicarPaleta(tema());
  document.title = tema().textos.produto;
  // O mundo e a UI leem o tema ao serem importados, por isso só entram depois de ele estar definido.
  const [{ createWorld }, { createUI }] = await Promise.all([import('./world'), import('./ui')]);
  const params = new URLSearchParams(location.search);
  const store = new OfficeStore({ mock: params.has('mock') });
  const world = createWorld(document.getElementById('world') as HTMLCanvasElement, store);
  const ui = document.getElementById('ui') as HTMLElement;
  createUI(ui, store, world, aviso);
  if (previa) ui.append(faixaDePrevia(tema().nome));
  // O tema ativo mudou (tema-ativo gravado): o mundo e a UI leem o tema ao carregar, então a página recomeça.
  store.on('tema', (t) => {
    if (chave !== undefined && t.chave !== chave) location.reload();
  });
  void aplicarFonte(tema(), ui);
  store.connect();

  // Facilita a depuração pelo console do navegador.
  Object.assign(window, { expediente: { store, world } });
})();
