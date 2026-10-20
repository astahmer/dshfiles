import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** A thread the palette's Ask DSH bar created and prompted before opening it. */
    askDsh: unknown
  }
}

export interface AskDshTarget<Workspace> {
  /** Project the question runs in; the Host default directory when omitted. */
  readonly workspaceId?: Workspace
}

export interface AskDshPorts<Workspace> {
  /** The Host mints a fresh Session when the request names none, so an open New thread blank is never reused. */
  createSession(input: { readonly workspaceId?: Workspace }): Promise<SessionId>
  /** Admit the question as the new thread's first user message. */
  prompt(input: { readonly sessionId: SessionId; readonly question: string }): Promise<void>
  openSession(sessionId: SessionId): void
}

/**
 * Send one question from the palette's Ask DSH bar, then open the thread it
 * created. The prompt is admitted before navigation, so the opened thread
 * already shows the question instead of a blank composer.
 */
export const askDsh = async <Workspace>(input: {
  readonly question: string
  readonly target: AskDshTarget<Workspace>
  readonly ports: AskDshPorts<Workspace>
}): Promise<SessionId> => {
  const question = input.question.trim()
  if (question.length === 0) throw new Error('Ask DSH needs a question.')
  const sessionId = await input.ports.createSession(input.target.workspaceId === undefined ? {} : { workspaceId: input.target.workspaceId })
  await input.ports.prompt({ sessionId, question })
  input.ports.openSession(sessionId)
  return sessionId
}
