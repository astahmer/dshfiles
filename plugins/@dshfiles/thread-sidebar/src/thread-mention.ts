import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-api-remotes/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { z } from 'zod'

export const THREAD_MENTION_CAPTURE_EVENT = 'dshfiles:thread-sidebar:mention-capture'
export const THREAD_MENTION_INSERT_EVENT = 'dshfiles:thread-sidebar:mention-insert'

const threadMentionRequestSchema = z.strictObject({ sessionId: z.string().min(1).max(512) })

export const decodeThreadMentionSessionId = (value: unknown): string | null => {
  const parsed = threadMentionRequestSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data.sessionId
}

export const buildThreadReferenceInsert = (candidate: Pick<SessionReferenceMentionCandidate, 'mention' | 'label' | 'displayTitle'>): ReferenceInsert => ({
  source: 'reference',
  ref: candidate.mention,
  label: candidate.displayTitle ?? candidate.label,
  appearance: 'session',
  clipboardText: candidate.mention,
})

export const captureThreadMentionInsertion = (): void => {
  window.dispatchEvent(new Event(THREAD_MENTION_CAPTURE_EVENT))
}

export const requestThreadMentionInsertion = (sessionId: string): void => {
  window.dispatchEvent(new CustomEvent(THREAD_MENTION_INSERT_EVENT, { detail: { sessionId } }))
}

export type ThreadMentionFailurePhase = 'remote-result' | 'exception'

export type ThreadMentionFailureDiagnosticInput = {
  phase: ThreadMentionFailurePhase
  errorName: string
  errorCode?: string
}

export type ThreadMentionFailureDiagnostic = {
  phase: ThreadMentionFailurePhase
  errorName: string
  errorCode?: string
}

export const threadMentionFailureCodeSchema = z.object({ code: z.string() })

export const summarizeThreadMentionFailure = (input: ThreadMentionFailureDiagnosticInput): ThreadMentionFailureDiagnostic => {
  const diagnostic: ThreadMentionFailureDiagnostic = {
    phase: input.phase,
    errorName: input.errorName,
  }
  if (input.errorCode !== undefined) diagnostic.errorCode = input.errorCode
  return diagnostic
}
