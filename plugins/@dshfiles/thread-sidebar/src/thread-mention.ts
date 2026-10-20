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

const sessionIdSchema = z.string().min(1).max(512)
const threadMentionRequestSchema = z.strictObject({ sessionId: sessionIdSchema })
const threadMentionInsertRequestSchema = z.strictObject({ sessionId: sessionIdSchema, hostSessionId: sessionIdSchema.optional() })
const threadMentionDragPayloadSchema = z.strictObject({ sessionId: sessionIdSchema })

/** A composer session plus the thread it should mention; the host is absent for an unaddressed request. */
export type ThreadMentionInsertRequest = z.infer<typeof threadMentionInsertRequestSchema>
export type ThreadMentionDragPayload = z.infer<typeof threadMentionDragPayloadSchema>

/** The slice of a drag transfer a mention source writes to. */
export interface ThreadMentionDragSink {
  effectAllowed: string
  setData: (format: string, value: string) => void
}

/** The slice of a drag transfer a Composer reads. */
export interface ThreadMentionDragSource {
  readonly types: readonly string[]
  getData: (format: string) => string
}

const decodeMentionSessionIdInput = (value: unknown): string | null => {
  const parsed = threadMentionRequestSchema.safeParse(value)
  if (!parsed.success) return null
  return parsed.data.sessionId
}

const decodeMentionInsertRequest = (value: unknown): ThreadMentionInsertRequest | null => {
  const parsed = threadMentionInsertRequestSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/** The seat a Composer drag lands on: one conversation's composer, never the attachment rail or the dock. */
const COMPOSER_SEAT = '[data-composer-seat]'
const CONVERSATION_SESSION = '[data-conversation-session]'
const THREAD_ASIDE = '[data-dshfiles-thread-aside]'

const composerSessionId = (seat: Element): string | undefined => {
  const value = seat.closest(CONVERSATION_SESSION)?.getAttribute('data-conversation-session') ?? ''
  return value === '' ? undefined : value
}

export class ThreadMentionModel {
  static readonly THREAD_MENTION_CAPTURE_EVENT = 'dshfiles:thread-sidebar:mention-capture'
  static readonly THREAD_MENTION_INSERT_EVENT = 'dshfiles:thread-sidebar:mention-insert'
  static readonly THREAD_MENTION_MIME = 'application/x-dshfiles-thread-mention'
  static readonly THREAD_MENTION_TARGET_ATTRIBUTE = 'data-dshfiles-mention-target'

  static readonly failureCodeSchema = z.object({ code: z.string() })
  private static readonly failureMessageSchema = z.object({ message: z.string().max(512) })

  static readonly decodeThreadMentionSessionId = decodeMentionSessionIdInput
  static readonly decodeThreadMentionInsertRequest = decodeMentionInsertRequest
  static readonly encodeThreadMentionDrag = (sessionId: string): string => JSON.stringify({ sessionId } satisfies ThreadMentionDragPayload)

  static readonly decodeThreadMentionDrag = (value: string): string | null => {
    let payload: unknown
    try {
      payload = JSON.parse(value)
    } catch {
      return null
    }
    const parsed = threadMentionDragPayloadSchema.safeParse(payload)
    return parsed.success ? parsed.data.sessionId : null
  }

  /** Put one thread on the drag payload a Composer accepts, without plain text that a rich editor would insert. */
  static readonly writeThreadMentionDrag = (dataTransfer: ThreadMentionDragSink, sessionId: string): void => {
    dataTransfer.setData(ThreadMentionModel.THREAD_MENTION_MIME, ThreadMentionModel.encodeThreadMentionDrag(sessionId))
    dataTransfer.effectAllowed = 'copyMove'
  }

  static readonly hasThreadMentionDrag = (dataTransfer: ThreadMentionDragSource | null | undefined): boolean =>
    dataTransfer !== null && dataTransfer !== undefined && dataTransfer.types.includes(ThreadMentionModel.THREAD_MENTION_MIME)

  /**
   * The session of the main view's composer, skipping an aside's embedded conversation.
   * @returns The composer host session id, or undefined when no main composer is on screen.
   */
  static readonly mainComposerSessionId = (): string | undefined => {
    for (const seat of document.querySelectorAll(COMPOSER_SEAT)) {
      if (seat.closest(THREAD_ASIDE) !== null) continue
      const sessionId = composerSessionId(seat)
      if (sessionId !== undefined) return sessionId
    }
    return undefined
  }

  static readonly readThreadMentionDrag = (dataTransfer: ThreadMentionDragSource | null | undefined): string | null => {
    if (dataTransfer === null || dataTransfer === undefined || !ThreadMentionModel.hasThreadMentionDrag(dataTransfer)) return null
    return ThreadMentionModel.decodeThreadMentionDrag(dataTransfer.getData(ThreadMentionModel.THREAD_MENTION_MIME))
  }

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

export const requestThreadMentionInsertion = (sessionId: string, hostSessionId?: string): void => {
  window.dispatchEvent(
    new CustomEvent(ThreadMentionModel.THREAD_MENTION_INSERT_EVENT, {
      detail: hostSessionId === undefined ? { sessionId } : { sessionId, hostSessionId },
    }),
  )
}
export const THREAD_MENTION_CAPTURE_EVENT = ThreadMentionModel.THREAD_MENTION_CAPTURE_EVENT
export const THREAD_MENTION_INSERT_EVENT = ThreadMentionModel.THREAD_MENTION_INSERT_EVENT
export const THREAD_MENTION_MIME = ThreadMentionModel.THREAD_MENTION_MIME
export const THREAD_MENTION_TARGET_ATTRIBUTE = ThreadMentionModel.THREAD_MENTION_TARGET_ATTRIBUTE
export const buildThreadReferenceInsert = ThreadMentionModel.buildThreadReferenceInsert
export const classifyThreadMentionFailure = ThreadMentionModel.classifyThreadMentionFailure
export const decodeThreadMentionInsertRequest = ThreadMentionModel.decodeThreadMentionInsertRequest
export const decodeThreadMentionSessionId = ThreadMentionModel.decodeThreadMentionSessionId
export const summarizeThreadMentionFailure = ThreadMentionModel.summarizeThreadMentionFailure
export const writeThreadMentionDrag = ThreadMentionModel.writeThreadMentionDrag

/** Read the thread a drag carries, or null when the drag is something else. */
export const readThreadMentionDrag = ThreadMentionModel.readThreadMentionDrag
/** Whether a live drag carries a thread mention payload. */
export const hasThreadMentionDrag = ThreadMentionModel.hasThreadMentionDrag

/** The `application/x-dshfiles-thread-mention` drag payload a Composer accepts. */
export const ThreadMentionDrag = {
  MIME: ThreadMentionModel.THREAD_MENTION_MIME,
  activeComposerSessionId: ThreadMentionModel.mainComposerSessionId,
  has: ThreadMentionModel.hasThreadMentionDrag,
  read: ThreadMentionModel.readThreadMentionDrag,
  write: ThreadMentionModel.writeThreadMentionDrag,
} as const

/** Free name main's client entry imports; the lane grouped the same schema under the model. */
export const threadMentionFailureCodeSchema = ThreadMentionModel.failureCodeSchema
