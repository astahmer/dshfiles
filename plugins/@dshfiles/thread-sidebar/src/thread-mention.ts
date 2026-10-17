import type { SessionReferenceMentionCandidate } from '@deepseek-ai/dsh-api-remotes/client'
import type { ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { z } from 'zod'

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

const threadMentionRequestSchema = z.strictObject({ sessionId: z.string().min(1).max(512) })

const decodeMentionSessionIdInput = (value: unknown): string | null => {
  const parsed = threadMentionRequestSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data.sessionId
}

export class ThreadMentionModel {
  static readonly THREAD_MENTION_CAPTURE_EVENT = 'dshfiles:thread-sidebar:mention-capture'
  static readonly THREAD_MENTION_INSERT_EVENT = 'dshfiles:thread-sidebar:mention-insert'

  static readonly failureCodeSchema = z.object({ code: z.string() })
  private static readonly failureMessageSchema = z.object({ message: z.string().max(512) })

  static readonly decodeThreadMentionSessionId = decodeMentionSessionIdInput

  static readonly buildThreadReferenceInsert = (candidate: Pick<SessionReferenceMentionCandidate, 'mention' | 'label' | 'displayTitle'>): ReferenceInsert => ({
    source: 'reference',
    ref: candidate.mention,
    label: candidate.displayTitle ?? candidate.label,
    appearance: 'session',
    clipboardText: candidate.mention,
  })

  static readonly classifyThreadMentionFailure = (error: unknown): ThreadMentionFailureKind => {
    const parsedFailure = ThreadMentionModel.failureMessageSchema.safeParse(error)
    if (!parsedFailure.success) return 'unclassified'
    const message = parsedFailure.data.message
    if (message.includes('expected') && message.includes(' argument(s)')) return 'argument-count-mismatch'
    if (message.includes('Remote method is no longer mounted')) return 'method-unmounted'
    if (message.includes('has no active Connection')) return 'connection-unavailable'
    if (message.includes('has no Client Context adapter')) return 'context-adapter-unavailable'
    if (message.includes('requires a "agent" Context')) return 'context-identity-required'
    return 'unclassified'
  }

  static readonly summarizeThreadMentionFailure = (input: ThreadMentionFailureDiagnosticInput): ThreadMentionFailureDiagnostic => {
    const diagnostic: ThreadMentionFailureDiagnostic = {
      phase: input.phase,
      errorName: input.errorName,
    }
    if (input.errorCode !== undefined) diagnostic.errorCode = input.errorCode
    if (input.failureKind !== undefined) diagnostic.failureKind = input.failureKind
    return diagnostic
  }
}

export const captureThreadMentionInsertion = (): void => {
  window.dispatchEvent(new Event(ThreadMentionModel.THREAD_MENTION_CAPTURE_EVENT))
}

export const requestThreadMentionInsertion = (sessionId: string): void => {
  window.dispatchEvent(new CustomEvent(ThreadMentionModel.THREAD_MENTION_INSERT_EVENT, { detail: { sessionId } }))
}
export const THREAD_MENTION_CAPTURE_EVENT = ThreadMentionModel.THREAD_MENTION_CAPTURE_EVENT
export const THREAD_MENTION_INSERT_EVENT = ThreadMentionModel.THREAD_MENTION_INSERT_EVENT
export const buildThreadReferenceInsert = ThreadMentionModel.buildThreadReferenceInsert
export const classifyThreadMentionFailure = ThreadMentionModel.classifyThreadMentionFailure
export const decodeThreadMentionSessionId = ThreadMentionModel.decodeThreadMentionSessionId
export const summarizeThreadMentionFailure = ThreadMentionModel.summarizeThreadMentionFailure

/** Free name main's client entry imports; the lane grouped the same schema under the model. */
export const threadMentionFailureCodeSchema = ThreadMentionModel.failureCodeSchema
