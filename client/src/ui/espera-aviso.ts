// Avisos de quem espera você: a partir de quantos alertas viram um só, e como nomear quem espera.

/** Dois ou mais alertas de espera viram um aviso só, em vez de um "Responder" por agente. */
export function deveAgrupar(alertas: number): boolean {
  return alertas >= 2;
}

/** "Jonas, Igor, Cecília e mais 10": os primeiros `max` nomes e quantos ficaram de fora. */
export function nomesDeQuemEspera(nomes: readonly string[], max = 3): string {
  const vistos = nomes.slice(0, max);
  const resto = nomes.length - vistos.length;
  return resto > 0 ? `${vistos.join(', ')} e mais ${resto}` : vistos.join(', ');
}
