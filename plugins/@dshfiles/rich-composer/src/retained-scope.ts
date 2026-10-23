import type { SessionId } from '@deepseek-ai/dsh-session/types'

interface ScopeLookup<Scope, Face extends { readonly sessionId: SessionId }> {
  sessionOf(scope: Scope): Face | undefined
  binding(sessionId: SessionId): { readonly session: Face } | undefined
}

/**
 * Whether a session-scope context still belongs to the retained Session generation. A hot replacement can leave a
 * scope whose generation was already swapped; `inputTriggers.sessionOf` throws for it, so a render path checks first.
 */
export const isRetainedScope = <Scope, Face extends { readonly sessionId: SessionId }>(sessions: ScopeLookup<Scope, Face>, scope: Scope): boolean => {
  const session = sessions.sessionOf(scope)
  return session !== undefined && sessions.binding(session.sessionId)?.session === session
}
