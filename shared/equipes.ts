/** Subagentes de uma sala que andam pelo escritório como personagens; os demais ficam na roda da equipe. */
export const MAX_INDIVIDUAIS = 8;

/** Chave do grupo de um subagente: o time, ou o pai quando não há time, dentro da sessão. */
export function chaveEquipe(s: { sessionId: string; teamName?: string; parentId?: string }): string {
  return `${s.sessionId}|${s.teamName ? `time:${s.teamName}` : `pai:${s.parentId ?? ''}`}`;
}
