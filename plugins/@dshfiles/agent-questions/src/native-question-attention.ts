import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import { attentionApi, type AttentionActOutcome, type AttentionActRequest, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin, HostContext, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Clock, Effect, Layer, Ref, Stream } from 'effect'
import { NativeQuestions } from './agent-host-promise.js'
import { projectNativeQuestion, type NativeQuestionInboxItem } from './question-inbox.js'
import { QuestionScan, type SessionQuestionTarget } from './question-scan.js'

/** The inbox source of native `ask_user_question` forms waiting in a running thread. */
export const NATIVE_QUESTION_SOURCE = 'agent-questions.native-question'

/** A form's tool call, its result and its reply arrive close together; one scan covers the burst. */
const RECONCILE_DEBOUNCE = '500 millis'
/** A Session that stops takes its form with it without a question event; the slow pass notices. */
const RECONCILE_SAFETY_INTERVAL = '60 seconds'

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

/** The one single-select question an Answer verb can submit in place, or undefined when the thread must answer it. */
const answerableQuestion = (item: NativeQuestionInboxItem) => {
  const [question, ...rest] = item.questions
  if (!item.canAnswer || question === undefined || rest.length > 0 || question.multiSelect) return undefined
  if (question.options.length === 0 || question.options.length > 8) return undefined
  return question
}

/**
 * One pending form in a live thread as a blocking item about it. A continued, single-question, single-select form is
 * answerable in place with its options; any other form (still open on the native waterfall, several questions, multi
 * select or free text) is answered in its thread.
 */
const draftOf = (item: NativeQuestionInboxItem): AttentionDraft | undefined => {
  const first = item.questions[0]
  if (first === undefined) return undefined
  const more = item.questions.length > 1 ? ` (+${String(item.questions.length - 1)} more)` : ''
  const answerable = answerableQuestion(item)
  const detail = answerable === undefined ? 'Open the thread to answer it there.' : 'Choose an answer here, or open the thread to write your own.'
  return {
    dedupeKey: `${item.sessionId}:${item.callId}`,
    subject: { kind: 'session', id: item.sessionId },
    reason: clamp(`Asks: ${first.question}${more}`, 500),
    detail: clamp(first.detail === undefined ? detail : `${first.detail}\n\n${detail}`, 2000),
    severity: 'blocking',
    verbs: answerable === undefined ? ['Open', 'Done', 'Snooze', 'MuteSource'] : ['Answer', 'Open', 'Done', 'Snooze', 'MuteSource'],
    ...(answerable !== undefined && {
      choices: answerable.options.map((option, index) => ({
        id: String(index),
        label: clamp(option.label.replace(/\s*\(Recommended\)\s*$/iu, ''), 120),
        ...(option.recommended && { recommended: true }),
      })),
    }),
  }
}

const draftsOf = (items: readonly NativeQuestionInboxItem[]): readonly AttentionDraft[] =>
  items.flatMap(item => {
    const draft = draftOf(item)
    return draft === undefined ? [] : [draft]
  })

/** Events that open, continue or settle a native form; everything else leaves the forms as they were. */
const touchesForms = (event: SessionEvent, pendingCallIds: ReadonlySet<string>): boolean => {
  if (event.type === 'tool/call') return event.data.name === 'ask_user_question'
  if (event.type === 'tool/ptc-dispatch') return event.data.name === 'ask_user_question'
  if (event.type === 'tool/result') return pendingCallIds.has(String(event.data.message.toolCallId))
  if (event.type === 'user/message') return event.data.source.kind === 'user-question-reply'
  return false
}

const refused = (message: string): AttentionActOutcome => ({ ok: false, message })

const make = Effect.gen(function* () {
  const host = yield* HostContext
  const native = yield* NativeQuestions
  const scans = yield* QuestionScan
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)
  const pending = yield* Ref.make<ReadonlyMap<string, NativeQuestionInboxItem>>(new Map())

  /** Every pending form in the live root threads, read from their question projections. */
  const read = Effect.gen(function* () {
    const liveRoots = native.liveRootIds()
    const targets: ReadonlyArray<SessionQuestionTarget> = yield* native.listTargets({ liveRoots, includeStopped: false })
    const observedAt = yield* Clock.currentTimeMillis
    const scan = yield* scans.scan({ targets: targets.filter(target => target.targetIsLiveRoot), now: observedAt })
    return scan.reads.flatMap(sessionRead =>
      (sessionRead.facts?.pending ?? []).map(question => {
        const wait = sessionRead.facts?.waits.find(record => record.callId === question.callId)
        const input = { ...sessionRead.target, pending: question, observedAt }
        return wait === undefined ? projectNativeQuestion(input) : projectNativeQuestion({ ...input, wait })
      }),
    )
  })

  const reconcile = Effect.fn('agent-questions native attention reconcile')(function* () {
    if (!(yield* apis.isServed(attentionApi))) return
    const items = yield* read
    yield* Ref.set(pending, new Map(items.map(item => [`${item.sessionId}:${item.callId}`, item])))
    const drafts = draftsOf(items)
    yield* Effect.annotateCurrentSpan({ 'attention.items': drafts.length })
    yield* inbox.reconcile({ source: NATIVE_QUESTION_SOURCE, items: [...drafts] })
  })

  /** Answer submits the chosen option through the native answer API, the same path answer_thread_question takes. */
  const answer = Effect.fn('agent-questions native attention answer')(function* (request: AttentionActRequest) {
    if (request.verb !== 'Answer') return refused('Thread questions take Answer here; open the thread for anything else.')
    const item = (yield* read).find(candidate => `${candidate.sessionId}:${candidate.callId}` === request.item.dedupeKey)
    if (item === undefined) return refused('This question is no longer waiting: it was answered, or its thread stopped. Mark the item done.')
    const question = answerableQuestion(item)
    if (question === undefined) return refused('This question cannot be answered from the Inbox. Open the thread and answer it there.')
    const option = question.options[Number(request.choiceId ?? '-1')]
    if (option === undefined) return refused('Pick one of the offered answers.')
    const status = native.answer({ sessionId: item.sessionId, callId: item.callId, answer: { answers: [{ id: question.id, selected: [option.label] }] } })
    if (status === 'queued') return { ok: true, message: `Answered “${clamp(option.label, 120)}”. The thread continues once it reads the reply.` }
    if (status === 'not-continued') return refused('This form is still open in the thread, which answers it there. Open the thread to answer.')
    return refused('The thread is not running, so it cannot receive an answer. Open the thread to resume it, then answer again.')
  })

  const services = yield* Effect.context<never>()
  const runAnswer = Effect.runPromiseWith(services)
  yield* Effect.acquireRelease(
    Effect.sync(() =>
      host.ctx.on('dshfiles/attention/act', request =>
        request.item.source === NATIVE_QUESTION_SOURCE
          ? runAnswer(answer(request).pipe(Effect.catchCause(() => Effect.succeed(refused('Answering failed on the Host. Open the thread and answer there.')))))
          : Promise.resolve(undefined),
      ),
    ),
    dispose => Effect.sync(dispose),
  )

  const formEvents = HostEvents.stream('session/event').pipe(
    Stream.filterEffect(([, event]) =>
      Effect.map(Ref.get(pending), current => touchesForms(event, new Set([...current.values()].map(item => item.callId)))),
    ),
  )

  yield* Stream.mergeAll(
    [
      Stream.succeed(undefined),
      Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined),
      Stream.map(formEvents, () => undefined),
      Stream.map(Stream.tick(RECONCILE_SAFETY_INTERVAL), () => undefined),
    ],
    { concurrency: 'unbounded' },
  ).pipe(
    Stream.debounce(RECONCILE_DEBOUNCE),
    Stream.runForEach(() => reconcile().pipe(Effect.catchCause(cause => Effect.logWarning('agent-questions: native question reconcile failed', cause)))),
    DshxPlugin.detached,
    Effect.forkScoped,
  )
})

/** Native question forms as an inbox provider: each form waiting in a live thread is a blocking item about it. */
export class NativeQuestionAttention {
  static readonly layer = Layer.effectDiscard(make)
  static readonly draftsOf = draftsOf
  static readonly touchesForms = touchesForms
}
