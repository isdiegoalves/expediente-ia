/** Chave do grupo de um subagente: o time, ou o pai quando não há time, dentro da sessão. */
export function chaveEquipe(s: { sessionId: string; teamName?: string; parentId?: string }): string {
  return `${s.sessionId}|${s.teamName ? `time:${s.teamName}` : `pai:${s.parentId ?? ''}`}`;
}
