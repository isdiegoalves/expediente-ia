import { readFileSync, statSync } from 'node:fs';
import { lerVersao, type VersaoView } from '../shared/versao';

const MAX_BYTES = 16 * 1024;

/** Lê o versao.json da ponte a cada chamada (o arquivo é pequeno e quem o troca é o host). */
export function createVersaoReader(file: string, emUso: string): () => VersaoView {
  return () => {
    let texto: string | null = null;
    try {
      if (statSync(file).size <= MAX_BYTES) texto = readFileSync(file, 'utf8');
    } catch {
      texto = null;
    }
    return lerVersao(texto, emUso);
  };
}
