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

export type ThreadMentionFailurePhase = 'remote-result' | 'resolver-exception' | 'candidate-processing-exception' | 'insertion-exception'
export type ThreadMentionFailureKind =
  | 'argument-count-mismatch'
  | 'method-unmounted'
  | 'connection-unavailable'
  | 'context-adapter-unavailable'
  | 'context-identity-required'
  | 'unclassified'

export type ThreadMentionFailureDiagnosticInput = {
  phase: ThreadMentionFailurePhase
  errorName: string
  errorCode?: string
  failureKind?: ThreadMentionFailureKind
}

export type ThreadMentionFailureDiagnostic = {
  phase: ThreadMentionFailurePhase
  errorName: string
  errorCode?: string
  failureKind?: ThreadMentionFailureKind
}

export const threadMentionFailureCodeSchema = z.object({ code: z.string() })
const threadMentionFailureMessageSchema = z.object({ message: z.string().max(512) })

export const classifyThreadMentionFailure = (failure: unknown): ThreadMentionFailureKind => {
  const parsedFailure = threadMentionFailureMessageSchema.safeParse(failure)
  if (!parsedFailure.success) return 'unclassified'
  const message = parsedFailure.data.message
  if (message.includes('expected') && message.includes(' argument(s)')) return 'argument-count-mismatch'
  if (message.includes('Remote method is no longer mounted')) return 'method-unmounted'
  if (message.includes('has no active Connection')) return 'connection-unavailable'
  if (message.includes('has no Client Context adapter')) return 'context-adapter-unavailable'
  if (message.includes('requires a "agent" Context')) return 'context-identity-required'
  return 'unclassified'
}

export const summarizeThreadMentionFailure = (input: ThreadMentionFailureDiagnosticInput): ThreadMentionFailureDiagnostic => {
  const diagnostic: ThreadMentionFailureDiagnostic = {
    phase: input.phase,
    errorName: input.errorName,
  }
  if (input.errorCode !== undefined) diagnostic.errorCode = input.errorCode
  if (input.failureKind !== undefined) diagnostic.failureKind = input.failureKind
  return diagnostic
}
