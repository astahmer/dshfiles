/** Questions another machine holds open, presented through the same card a forwarded request uses. */
import type { AskUserQuestionItem } from '@deepseek-ai/dsh-user-questions/types'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { RemoteInteraction, RemoteQuestionAnswer } from '@dshfiles/multi-host/api'
import type { QuestionAnswer, QuestionWaterfallChannel } from './native/contract/slots.ts'

type QuestionRow = RemoteInteraction & { readonly request: Extract<RemoteInteraction['request'], { readonly kind: 'question' }> }

const isQuestion = (row: RemoteInteraction): row is QuestionRow => row.request.kind === 'question'

/** One wire question as the card reads it. Only the fields the card renders cross; a `plan-review` intent stays one. */
const toItem = (question: QuestionRow['request']['questions'][number]): AskUserQuestionItem => {
  const { detail, header, intent, multiSelect, options } = question
  return {
    id: question.id,
    question: question.question,
    ...(detail !== undefined && { detail }),
    ...(header !== undefined && { header }),
    ...(multiSelect !== undefined && { multiSelect }),
    ...(options !== undefined && {
      options: options.map(option => ({ label: option.label, ...(option.description !== undefined && { description: option.description }) })),
    }),
    ...(intent?.kind === 'plan-review' && {
      intent: {
        kind: 'plan-review' as const,
        approve: intent.approve,
        ...(intent.callId !== undefined && { callId: brandString<ToolCallId>(intent.callId) }),
      },
    }),
  }
}

/** The card a request is presented through; the registry that owns it decides when a tool-call card ends. */
export interface RemoteQuestionCard {
  readonly attachWaterfall: (channel: QuestionWaterfallChannel) => void
  readonly detachWaterfall: (channel: QuestionWaterfallChannel) => void
  readonly trackRequest: (completion: Promise<void>) => () => void
  /** End a card nothing else can close: a blocking request has no tool call for the projection to settle. */
  readonly remove: () => void
}

/** What the owning runtime's Host path offers one card. */
export interface RemoteQuestionPorts {
  readonly cardFor: (input: {
    readonly sessionId: SessionId
    readonly questions: readonly AskUserQuestionItem[]
    readonly callId: ToolCallId | undefined
  }) => RemoteQuestionCard
  readonly answer: (input: { readonly sessionId: string; readonly interactionId: string; readonly answer: RemoteQuestionAnswer }) => Promise<void>
  readonly decline: (input: { readonly sessionId: string; readonly interactionId: string; readonly reason: 'cancelled' | 'timed-out' }) => Promise<void>
  /** A held request ended: the projection may now close its card. */
  readonly ended: () => void
}

interface Presented {
  readonly card: RemoteQuestionCard
  readonly callId: string | undefined
  readonly channel: QuestionWaterfallChannel
  readonly finish: () => void
}

/** Keep the cards equal to what the owners hold. The owner decides: an answer it refuses stays a failed attempt here. */
export class RemoteQuestions {
  readonly #presented = new Map<string, Presented>()
  readonly #ports: RemoteQuestionPorts

  constructor(ports: RemoteQuestionPorts) {
    this.#ports = ports
  }

  #channel(row: QuestionRow): QuestionWaterfallChannel {
    const { id: interactionId, sessionId } = row
    const remainingMs = row.request.remainingMs
    const decline = (reason: 'cancelled' | 'timed-out'): void => {
      // A refused decline leaves the request held, so the next sync keeps its card; the owner's own timer still runs.
      this.#ports.decline({ sessionId, interactionId, reason }).catch((error: unknown) => {
        console.error('user-questions: the remote host did not take this cancellation', error)
      })
    }
    return {
      deadline: remainingMs === undefined ? undefined : Date.now() + remainingMs,
      resolve: (answer: QuestionAnswer) => this.#ports.answer({ sessionId, interactionId, answer }),
      reject: code => {
        decline(code === 'ASK_CANCELLED' ? 'cancelled' : 'timed-out')
      },
      // Leaving the seat here hands nothing on: the owner keeps the request for its own UI.
      delegate: () => undefined,
    }
  }

  #present(row: QuestionRow): void {
    const callId = row.request.callId
    const card = this.#ports.cardFor({
      sessionId: SessionId(row.sessionId),
      questions: row.request.questions.map(toItem),
      callId: callId === undefined ? undefined : brandString<ToolCallId>(callId),
    })
    const channel = this.#channel(row)
    const completion = Promise.withResolvers<void>()
    const stopTracking = card.trackRequest(completion.promise)
    card.attachWaterfall(channel)
    this.#presented.set(row.id, {
      card,
      callId,
      channel,
      finish: () => {
        stopTracking()
        completion.resolve()
      },
    })
  }

  sync(rows: readonly RemoteInteraction[]): void {
    const held = rows.filter(isQuestion)
    const current = new Set(held.map(row => row.id))
    let ended = false
    for (const [id, presented] of this.#presented) {
      if (current.has(id)) continue
      this.#presented.delete(id)
      this.#end(presented)
      ended = true
    }
    for (const row of held) if (!this.#presented.has(row.id)) this.#present(row)
    if (ended) this.#ports.ended()
  }

  #end(presented: Presented): void {
    presented.card.detachWaterfall(presented.channel)
    presented.finish()
    if (presented.callId === undefined) presented.card.remove()
  }

  dispose(): void {
    for (const presented of this.#presented.values()) presented.finish()
    this.#presented.clear()
  }
}
