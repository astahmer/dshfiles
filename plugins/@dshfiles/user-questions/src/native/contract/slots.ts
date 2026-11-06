/** Question composer props and one pending Remote waterfall response. */
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
// The client module declares the conversation.composer SlotMap entry required by PropsRuntime.
import type { ToolCallId } from '@deepseek-ai/dsh-llm/brand'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  AskUserQuestionAnswer, AskUserQuestionAnswerItem, AskUserQuestionItem, UserQuestionState,
} from '@deepseek-ai/dsh-user-questions/types'
import type { createQuestionDraftStore } from '../draft-store.ts'

declare module '@deepseek-ai/dsh-client-ui-session/client' {
  interface SessionPendingInteractionMap {
    /** Pending question or plan-review request. */
    question: PendingQuestion
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Actions for the exact plan under review; approval remains with the question composer. */
    'conversation.plan-review.actions': { kind: 'list'; scope: 'session'; owner: { review: PlanReview; requestKey: PendingQuestion['key'] } }
  }
}

/** One structured answer batch covering every question of the request. */
export type QuestionAnswer = AskUserQuestionAnswer

/** One question of the request. */
type QuestionItem = AskUserQuestionItem

/** One option the asker offered on a question. */
type QuestionOption = NonNullable<QuestionItem['options']>[number]

/* jscpd:ignore-start -- Question and Approval intentionally own independent pending-settlement lifecycles. */
function settlePendingComposer(settle: () => void, failureMessage: string): Promise<void> {
  try {
    settle()
    return Promise.resolve()
  } catch (error) {
    return Promise.reject(error instanceof Error
      ? error
      : new Error(failureMessage, { cause: error }))
  }
}
/* jscpd:ignore-end */

/**
 * A request narrowed to the `plan-review` presentation intent: everything the
 * decision card renders and answers with, so the panel never re-reads the
 * request fields. `approve` and `decline` are the asker's own options — an
 * answer must carry one of those labels verbatim — and `plan` is the markdown
 * body under review.
 */
export interface PlanReview {
  /** The reviewed question's id, echoed in the answer. */
  id: string
  /** The question text, kept as the card's accessible name. */
  question: string
  /** The plan markdown under review. */
  plan: string
  /** Logged tool invocation used to reopen this plan. */
  callId?: ToolCallId
  /** The option that approves the plan. */
  approve: QuestionOption
  /** The option that declines it; absent when the asker offered no other option. */
  decline?: QuestionOption
}

/**
 * Narrow a request to a renderable plan review, or return undefined to leave it
 * to the generic question flow.
 *
 * The card offers approval and a return to the composer for change requests.
 * It accepts one question carrying the plan as detail and the named approve
 * option, with at most one alternative and no multi-select. Larger choices
 * remain in the generic question flow.
 *
 * @param questions - the request's whole question batch.
 * @returns The narrowed review, or undefined when the generic flow owns it.
 */
export function planReviewOf(questions: readonly QuestionItem[]): PlanReview | undefined {
  if (questions.length !== 1) return undefined
  // Length-checked above; the index read is the narrowing tax, not a guess.
  const question = questions[0] as QuestionItem
  const intent = question.intent
  if (intent?.kind !== 'plan-review' || question.detail === undefined) return undefined
  if (question.multiSelect === true) return undefined
  const options = question.options ?? []
  if (options.length > 2) return undefined
  const approve = options.find(option => option.label === intent.approve)
  if (approve === undefined) return undefined
  const decline = options.find(option => option.label !== intent.approve)
  return {
    id: question.id,
    question: question.question,
    plan: question.detail,
    ...(intent.callId === undefined ? {} : { callId: intent.callId }),
    approve,
    ...(decline === undefined ? {} : { decline }),
  }
}


/** Reload-unique prefix so an unnamed legacy card cannot reuse a persisted draft. */
const unnamedQuestionPrefix = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(16)),
  byte => byte.toString(16).padStart(2, '0')).join('')
let nextQuestionKey = 0

/** Rejection codes a Client returns through the waterfall; the wire preserves `name` and `code`. */
export type QuestionRejectionCode = 'ASK_ABORTED' | 'ASK_CANCELLED' | 'ASK_TIMED_OUT'

const rejectionMessages: Record<QuestionRejectionCode, string> = {
  ASK_ABORTED: 'ask_user_question was aborted before the user answered',
  ASK_CANCELLED: 'the user cancelled ask_user_question',
  ASK_TIMED_OUT: 'ask_user_question timed out before the user answered',
}

/** Create a wire-preserved user-question rejection. */
function questionError(code: QuestionRejectionCode): Error {
  const error = new Error(rejectionMessages[code]) as Error & { code: string }
  error.name = 'UserQuestionError'
  error.code = code
  return error
}

/** One live Host waterfall attached to a card; it settles once and then detaches. */
export interface QuestionWaterfallChannel {
  /** Client-clock deadline in epoch milliseconds; absent for a blocking question. */
  readonly deadline: number | undefined
  /** Resolve the Host waterfall with the whole answer batch. */
  resolve(answer: QuestionAnswer): void
  /** Reject the Host waterfall with a wire-preserved code. */
  reject(code: Exclude<QuestionRejectionCode, 'ASK_ABORTED'>): void
  /** Hand the request to the next waterfall listener. */
  delegate(): void
}

/** The Remote answer path of a continued question. */
export interface QuestionRpcChannel {
  /** Steer the answer into the agent; false when the question is no longer continued. Rejects when a reply is already queued. */
  answer(answer: QuestionAnswer): Promise<boolean>
}

/** The composer seat a card occupies while it is visible. */
export interface QuestionSeat {
  /** Withdraw the card from the pending-interaction registry without ending the request. */
  hide(): void
}

/** One waterfall request as the Remote Event listener awaits it. */
export interface QuestionWaterfallRequest {
  readonly channel: QuestionWaterfallChannel
  /** Outcome returned to the Host: the answer, or a wire-preserved rejection. */
  readonly result: Promise<QuestionAnswer>
  /**
   * Test whether a rejection asks the listener to call `next()`.
   * @param reason - rejection received from {@link QuestionWaterfallRequest.result}.
   * @returns whether {@link QuestionWaterfallChannel.delegate} produced it.
   */
  isDelegation(reason: unknown): boolean
}

/**
 * Create the deferred one Remote Event listener settles through a card.
 * The request signal ends the channel with `ASK_ABORTED`; the Host ignores that
 * outcome for an event it already finished, so a cancel frame loses nothing.
 * @param deadline - Client-clock deadline in epoch milliseconds derived from the business claim's remaining duration.
 * @param signal - Delivery lifetime of the forwarded request.
 * @param onSettle - Called once with the channel when it settles or aborts.
 * @returns The channel to attach and the promise the listener awaits.
 */
export function createWaterfallRequest(
  deadline: number | undefined,
  signal: AbortSignal | undefined,
  onSettle: (channel: QuestionWaterfallChannel) => void,
): QuestionWaterfallRequest {
  const completion = Promise.withResolvers<QuestionAnswer>()
  const delegated = Symbol('pending question delegated')
  let settled = false
  const finish = (settle: () => void): void => {
    if (settled) return
    settled = true
    signal?.removeEventListener('abort', onAbort)
    settle()
    onSettle(channel)
  }
  const onAbort = (): void => {
    finish(() => { completion.reject(questionError('ASK_ABORTED')) })
  }
  const channel: QuestionWaterfallChannel = {
    deadline,
    resolve: (answer) => { finish(() => { completion.resolve(answer) }) },
    reject: (code) => { finish(() => { completion.reject(questionError(code)) }) },
    delegate: () => { finish(() => { completion.reject(delegated) }) },
  }
  if (signal !== undefined) {
    signal.addEventListener('abort', onAbort, { once: true })
    if (signal.aborted) onAbort()
  }
  return { channel, result: completion.promise, isDelegation: reason => reason === delegated }
}

/**
 * Where one pending question's foreground wait stands. Exactly one phase is
 * active, so a held question can never also be focused or editing, and a live
 * deadline only exists while counting.
 */
export type QuestionWaitPhase =
  /** Counting down to `deadline`; absent for a request that carried none. */
  | { readonly kind: 'counting'; readonly deadline: number | undefined }
  /** Frozen by focus, holding the remaining duration for a later resume. */
  | { readonly kind: 'paused'; readonly remainingMs: number | undefined }
  /** The user edited a draft: the request now waits indefinitely. */
  | { readonly kind: 'editing'; readonly remainingMs: number | undefined }
  /** The user took over the wait; the waterfall waits like a blocking question. */
  | { readonly kind: 'waiting' }
  /** The local countdown rejected the waterfall with `ASK_TIMED_OUT`. */
  | { readonly kind: 'timedOut' }
  /** The card left the registry; no wait runs any more. */
  | { readonly kind: 'closed' }

/**
 * The one answer attempt a card records, so every presentation renders the same
 * in-flight, sent or failed controls.
 */
export type QuestionSubmission =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting'; readonly intent: 'answer' | 'cancel'; readonly channel: 'waterfall' | 'rpc' }
  /** The waterfall accepted it; the projection closes the card when the Host records it. */
  | { readonly kind: 'sent'; readonly intent: 'answer' | 'cancel' }
  | { readonly kind: 'failed'; readonly reason: 'error'; readonly message: string }
  /** The Remote answer was taken but the panel could not be withdrawn. */
  | { readonly kind: 'failed'; readonly reason: 'sent' }
  /** The question continued while a waterfall attempt was in flight; the draft can go again. */
  | { readonly kind: 'failed'; readonly reason: 'resubmit' }

/** Render one thrown value as a card's failed attempt. */
const failureMessageOf = (cause: unknown): string => cause instanceof Error ? cause.message : String(cause)

/** Reactive card state read by every mounted presentation of one question. */
export interface QuestionCardSnapshot {
  /** Mirrors the projection row; `open` until the projection says otherwise. */
  readonly state: UserQuestionState
  /** The single active wait phase. */
  readonly phase: QuestionWaitPhase
  /** The single answer attempt, `idle` until the user sends or cancels. */
  readonly submission: QuestionSubmission
  /** User-visible foreground wait presentation. */
  readonly waitState: 'counting' | 'focused' | 'editing' | 'waiting' | 'continued'
  /**
   * Foreground countdown presentation, absent for a request that carried no
   * deadline. The card owns the ticking, so a hidden panel keeps counting and
   * still times out; `running` is false while a hold or an edit froze it.
   */
  readonly countdown: { readonly remainingMs: number; readonly running: boolean } | undefined
  /** Channel a submission would use right now. */
  readonly channel: 'waterfall' | 'rpc' | 'none'
  /** Set once the card left the registry; the mounted composer clears its draft on this. */
  readonly closed: boolean
}

/**
 * One answerable Client card. A card keyed by tool call is created by whichever
 * source arrives first, the forwarded waterfall or the Session projection, and
 * removed only when the projection no longer lists the call.
 */
export class PendingQuestion {
  /** Presentation discriminator used by Session pending-interaction consumers. */
  readonly kind: 'question' | 'plan-review'
  /** Render identity and request key for the Session-scoped draft store. */
  readonly key: string
  /** Agent/Session identity owning the request. */
  readonly sessionId: SessionId
  /** The request's question list. */
  readonly questions: readonly AskUserQuestionItem[]
  /** Tool call identity; absent for a blocking request that carried no `wait`. */
  readonly callId: ToolCallId | undefined
  /**
   * Recorded answers of a call that already settled. Present only on a
   * read-only review card, which the tool call row builds from its own
   * transcript so a finished question can be read back in the panel that
   * asked it. Such a card has no answer channel and no countdown.
   */
  readonly review: readonly AskUserQuestionAnswerItem[] | undefined
  /**
   * What closing the panel does. A card keyed by tool call stays reachable
   * from its tool call row, so closing only withdraws the panel (`hide`) and
   * persists nothing. A card the Host never named has no way back, so closing
   * it ends the request (`cancel`).
   */
  readonly dismissal: 'hide' | 'cancel'

  #projection: UserQuestionState = 'open'
  #phase: QuestionWaitPhase = { kind: 'counting', deadline: undefined }
  #submission: QuestionSubmission = { kind: 'idle' }
  #waterfall: QuestionWaterfallChannel | undefined
  #rpc: QuestionRpcChannel | undefined
  #seat: QuestionSeat | undefined
  #timer: ReturnType<typeof setInterval> | undefined
  readonly #siblings: (() => readonly string[]) | undefined
  readonly #listeners = new Set<() => void>()
  #snapshot: QuestionCardSnapshot

  /**
   * @param sessionId - Agent/Session identity owning the request.
   * @param questions - complete question batch.
   * @param callId - tool call identity when the Host named one.
   * @param siblings - keys of every card currently registered for the Session, for draft pruning.
   * @param review - recorded answers of a settled call, making this a read-only card.
   */
  constructor(
    sessionId: SessionId,
    questions: readonly AskUserQuestionItem[],
    callId?: ToolCallId,
    siblings?: () => readonly string[],
    review?: readonly AskUserQuestionAnswerItem[],
  ) {
    this.sessionId = sessionId
    this.questions = questions
    this.kind = planReviewOf(questions) === undefined ? 'question' : 'plan-review'
    this.callId = callId
    this.review = review
    this.dismissal = callId === undefined ? 'cancel' : 'hide'
    this.#siblings = siblings
    if (callId === undefined) nextQuestionKey += 1
    this.key = callId === undefined
      ? `question:${unnamedQuestionPrefix}:${String(nextQuestionKey)}`
      : PendingQuestion.keyOf(sessionId, callId)
    this.#snapshot = this.createSnapshot()
  }

  /**
   * Card key of a tool call, shared by every source that names one. The Host
   * request and the Session projection carry the branded `ToolCallId`; a
   * transcript row carries the same wire value as a plain string.
   * @param sessionId - owning Session.
   * @param callId - tool call identity, branded or as a transcript spells it.
   * @returns the render identity and draft key.
   */
  static keyOf(sessionId: SessionId, callId: string): string {
    return `question:${String(sessionId)}:${callId}`
  }

  /**
   * Draft keys that are still live in this Session, this card included.
   * @returns keys the draft store must keep; everything else is stale.
   */
  liveKeys(): readonly string[] {
    return this.#siblings?.() ?? [this.key]
  }

  /** Subscribe to card state changes. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener)
    return () => { this.#listeners.delete(listener) }
  }

  /** Read the stable current card state. */
  readonly snapshot = (): QuestionCardSnapshot => this.#snapshot

  /** Observable snapshot read by the renderer's keyed Hook. */
  readonly getSnapshot = this.snapshot

  private createSnapshot(): QuestionCardSnapshot {
    const phase = this.#phase
    return {
      state: this.#projection,
      phase,
      submission: this.#submission,
      waitState: this.#waitStateOf(phase),
      countdown: this.#countdownOf(phase),
      channel: this.#channelOf(),
      closed: phase.kind === 'closed',
    }
  }

  #channelOf(): QuestionCardSnapshot['channel'] {
    if (this.#waterfall !== undefined) return 'waterfall'
    return this.#projection === 'continued' && this.#rpc !== undefined ? 'rpc' : 'none'
  }

  #waitStateOf(phase: QuestionWaitPhase): QuestionCardSnapshot['waitState'] {
    if (this.#projection === 'continued') return 'continued'
    switch (phase.kind) {
      case 'paused': return 'focused'
      case 'editing': return 'editing'
      case 'waiting': return 'waiting'
      case 'counting':
      case 'timedOut':
      case 'closed': return 'counting'
    }
  }

  /**
   * The countdown a timed request shows. Its presence follows the attached
   * waterfall, because a request without a deadline never displayed one.
   */
  #countdownOf(phase: QuestionWaitPhase): QuestionCardSnapshot['countdown'] {
    if (this.#waterfall?.deadline === undefined) return undefined
    switch (phase.kind) {
      case 'counting': {
        const deadline = phase.deadline
        return {
          remainingMs: deadline === undefined ? 0 : Math.max(0, deadline - Date.now()),
          running: deadline !== undefined,
        }
      }
      case 'paused':
      case 'editing': return { remainingMs: phase.remainingMs ?? 0, running: false }
      case 'waiting': return { remainingMs: 0, running: false }
      case 'timedOut':
      case 'closed': return undefined
    }
  }

  private publish(): void {
    this.#snapshot = this.createSnapshot()
    this.#reschedule()
    for (const listener of this.#listeners) listener()
  }

  /**
   * Own the countdown here rather than in a mounted component: the panel can be
   * hidden and remounted while the request stands, and a timer that died with
   * the component would leave the tool call waiting past its deadline.
   */
  #reschedule(): void {
    const phase = this.#phase
    const wanted = phase.kind === 'counting' && phase.deadline !== undefined
    if (wanted === (this.#timer !== undefined)) return
    if (!wanted) {
      clearInterval(this.#timer)
      this.#timer = undefined
      return
    }
    this.#timer = setInterval(() => { this.#tick() }, 1000)
  }

  #tick(): void {
    const phase = this.#phase
    /* v8 ignore next -- #reschedule clears the interval in the same publish that leaves the counting phase. */
    if (phase.kind !== 'counting' || phase.deadline === undefined) return
    if (Date.now() >= phase.deadline) {
      this.timeout()
      return
    }
    this.publish()
  }

  /**
   * Attach the live waterfall of a forwarded request.
   * @param channel - request channel created by {@link createWaterfallRequest}.
   */
  attachWaterfall(channel: QuestionWaterfallChannel): void {
    this.#waterfall = channel
    const phase = this.#phase
    if (phase.kind === 'counting') {
      this.#phase = { kind: 'counting', deadline: channel.deadline }
    } else if (phase.kind === 'paused' && channel.deadline !== undefined) {
      this.#phase = { kind: 'paused', remainingMs: Math.max(0, channel.deadline - Date.now()) }
    }
    this.publish()
  }

  /**
   * Drop a waterfall channel that settled or was cancelled; the card stays.
   * @param channel - the channel that ended.
   */
  detachWaterfall(channel: QuestionWaterfallChannel): void {
    if (this.#waterfall !== channel) return
    this.#waterfall = undefined
    if (this.#phase.kind === 'counting') this.#phase = { kind: 'counting', deadline: undefined }
    this.publish()
  }

  /**
   * Whether a live waterfall is attached.
   * @returns whether the pending Host request still accepts settlement.
   */
  hasWaterfall(): boolean {
    return this.#waterfall !== undefined
  }

  /**
   * Attach the Remote answer path used once the question is continued.
   * @param channel - Remote calls bound to this Session and call.
   */
  attachRpc(channel: QuestionRpcChannel): void {
    this.#rpc = channel
    this.publish()
  }

  /**
   * Attach the composer seat this card is published into.
   * @param seat - withdrawal of the published panel, owned by the card registry.
   */
  attachSeat(seat: QuestionSeat): void {
    this.#seat = seat
  }

  /**
   * Copy the projection row state.
   * @param state - `open` or `continued`.
   */
  setState(state: UserQuestionState): void {
    if (this.#projection === state) return
    this.#projection = state
    if (state === 'continued' && this.#waterfallAttempt()) {
      this.#submission = { kind: 'failed', reason: 'resubmit' }
    }
    this.publish()
  }

  /** Whether a recorded attempt is still waiting for the card to close. */
  #waterfallAttempt(): boolean {
    const submission = this.#submission
    return submission.kind === 'sent'
      || (submission.kind === 'submitting' && submission.channel === 'waterfall')
  }

  /** Whether an attempt is in flight; a second one would race it. */
  #inFlight(): boolean {
    return this.#submission.kind === 'submitting' || this.#submission.kind === 'sent'
  }

  /** Stop this Client's countdown indefinitely; the waterfall then waits like a blocking question. */
  takeTime(): void {
    const phase = this.#phase
    if (phase.kind === 'waiting' || phase.kind === 'timedOut' || phase.kind === 'closed') return
    this.#phase = { kind: 'waiting' }
    this.publish()
  }

  /**
   * Record focus even before the request arrives, freezing a pristine countdown once attached.
   * @param now - current Client epoch time.
   */
  holdFocus(now = Date.now()): void {
    const phase = this.#phase
    if (phase.kind !== 'counting') return
    this.#phase = {
      kind: 'paused',
      remainingMs: phase.deadline === undefined ? undefined : Math.max(0, phase.deadline - now),
    }
    this.publish()
  }

  /**
   * Resume a pristine countdown after the answer surface loses focus.
   * @param now - current Client epoch time.
   */
  releaseFocus(now = Date.now()): void {
    const phase = this.#phase
    if (phase.kind !== 'paused') return
    const remainingMs = phase.remainingMs
    const resumed = remainingMs !== undefined && this.#waterfall?.deadline !== undefined
    this.#phase = { kind: 'counting', deadline: resumed ? now + remainingMs : undefined }
    this.publish()
  }

  /**
   * Keep the first edited draft answerable without a foreground deadline.
   * @param now - current Client epoch time used to preserve the remaining duration.
   */
  engage(now = Date.now()): void {
    const phase = this.#phase
    if (phase.kind !== 'counting' && phase.kind !== 'paused') return
    const remainingMs = phase.kind === 'paused'
      ? phase.remainingMs
      : phase.deadline === undefined ? undefined : Math.max(0, phase.deadline - now)
    this.#phase = { kind: 'editing', remainingMs }
    this.publish()
  }

  /** Local countdown reached zero: settle the waterfall with `ASK_TIMED_OUT`, keep the card. */
  timeout(): void {
    if (this.#phase.kind !== 'counting') return
    const channel = this.#waterfall
    if (channel === undefined) return
    this.#waterfall = undefined
    channel.reject('ASK_TIMED_OUT')
    this.#phase = { kind: 'timedOut' }
    this.publish()
  }

  /** Hand a live waterfall to the next listener when this presentation domain unloads. */
  delegate(): void {
    this.#waterfall?.delegate()
  }

  /** Mark the card removed from the registry; the mounted composer clears its draft. */
  close(): void {
    if (this.#phase.kind === 'closed') return
    this.#phase = { kind: 'closed' }
    this.#submission = { kind: 'idle' }
    this.publish()
  }

  /** Clear a failed attempt so the next edit starts from idle. */
  resetSubmission(): void {
    if (this.#submission.kind !== 'failed') return
    this.#submission = { kind: 'idle' }
    this.publish()
  }

  async #answerWaterfall(answer: QuestionAnswer): Promise<void> {
    const waterfall = this.#waterfall
    if (waterfall === undefined) throw new Error('no channel accepts an answer yet')
    await settlePendingComposer(() => { waterfall.resolve(answer) }, 'pending question settlement failed')
  }

  async #answerRemote(answer: QuestionAnswer): Promise<void> {
    const rpc = this.#rpc
    if (rpc === undefined || this.#projection !== 'continued') throw new Error('no channel accepts an answer yet')
    const accepted = await rpc.answer(answer)
    if (!accepted) throw new Error('this question is no longer answerable')
  }

  /**
   * Submit the whole answer batch and record the attempt on the card, so the
   * panel renders one in-flight, sent or failed state instead of its own flags.
   * A second attempt while one stands is a no-op.
   * @param answer - complete structured answer batch.
   */
  async submit(answer: QuestionAnswer): Promise<void> {
    if (this.#inFlight()) return
    const remote = this.#channelOf() === 'rpc'
    this.#submission = { kind: 'submitting', intent: 'answer', channel: remote ? 'rpc' : 'waterfall' }
    this.publish()
    try {
      if (!remote) {
        await this.#answerWaterfall(answer)
        this.#submission = { kind: 'sent', intent: 'answer' }
        this.publish()
        return
      }
      await this.#answerRemote(answer)
      this.#submission = { kind: 'idle' }
      this.publish()
      await this.dismiss().catch(() => {
        this.#submission = { kind: 'failed', reason: 'sent' }
        this.publish()
      })
    } catch (error) {
      this.#submission = { kind: 'failed', reason: 'error', message: failureMessageOf(error) }
      this.publish()
    }
  }

  /**
   * End the request through its waterfall, recording the attempt like an
   * answer; a tool-call-keyed card only leaves its seat instead.
   */
  async cancel(): Promise<void> {
    if (this.dismissal === 'hide') {
      await this.dismiss()
      return
    }
    if (this.#inFlight()) return
    this.#submission = { kind: 'submitting', intent: 'cancel', channel: 'waterfall' }
    this.publish()
    try {
      const waterfall = this.#waterfall
      if (waterfall === undefined) throw new Error('no channel accepts a cancellation yet')
      await settlePendingComposer(() => { waterfall.reject('ASK_CANCELLED') }, 'pending question cancellation failed')
      this.#submission = { kind: 'sent', intent: 'cancel' }
      this.publish()
    } catch (error) {
      this.#submission = { kind: 'failed', reason: 'error', message: failureMessageOf(error) }
      this.publish()
    }
  }

  /**
   * Withdraw the panel from the composer seat without ending the request: the
   * countdown keeps running here and the tool call row reopens it.
   */
  dismiss(): Promise<void> {
    return settlePendingComposer(() => { this.#seat?.hide() }, 'pending question hide failed')
  }
}

/** Pending value returned by the composer-chain selector. */
export type QuestionWait = PendingQuestion

/**
 * Full component props: the framework runtime share (chain currency +
 * session/global standard kit) plus the chain `matched` share — the entry's
 * selector result, already narrowed to the question carrier — plus the
 * standard locale seat; the carrier plus the domain face above carry the
 * whole behavior surface.
 */
export type QuestionComposerProps =
  PropsRuntime<'conversation.composer'>
  & PropsStore<ReturnType<typeof createQuestionDraftStore>>
  & PropsRenderSlots<'conversation.plan-review.actions'>
  & InjectFace<{ keyedHooks: { questionCard: (key: string) => PendingQuestion | undefined } }>
  & { matched: QuestionWait }
  & PropsLocale<'question'>
