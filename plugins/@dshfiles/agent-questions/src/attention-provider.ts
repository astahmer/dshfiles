import { attentionApi, type AttentionActOutcome, type AttentionActRequest, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Clock, Effect, Layer, Stream } from 'effect'
import { AgentDirectory } from './agent-host-promise.js'
import { handleAttentionActs } from './attention-act-promise.js'
import { ParentQuestions } from './parent-questions.js'
import { QuestionStore } from './question-store.js'
import type { ParentQuestionRecord } from './store.js'

/** The inbox source of direct-child questions waiting for their parent thread. */
export const CHILD_QUESTION_SOURCE = 'agent-questions.child-question'

/** Coalesce a burst of writes (admit, notify, settle) into one reconcile. */
const RECONCILE_DEBOUNCE = '200 millis'
/** A missed change or an expiry nobody waited for still converges. */
const RECONCILE_SAFETY_INTERVAL = '60 seconds'

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

/** One pending, unexpired question as an inbox item about its parent thread, answerable in place by its options. */
const draftOf = (record: ParentQuestionRecord): AttentionDraft => {
  const context = record.context?.trim() ?? ''
  return {
    dedupeKey: record.questionId,
    subject: { kind: 'session', id: record.parentSessionId },
    reason: clamp(`A subagent asks: ${record.question}`, 500),
    ...(context.length > 0 && { detail: clamp(context, 2000) }),
    severity: 'blocking',
    verbs: ['Answer', 'Open', 'Done', 'Snooze', 'MuteSource'],
    choices: record.options.map(option => ({
      id: option.id,
      label: clamp(option.label, 120),
      ...(option.id === record.recommendedOptionId && { recommended: true }),
    })),
  }
}

const openDrafts = (records: Iterable<ParentQuestionRecord>, now: number): readonly AttentionDraft[] =>
  [...records].filter(record => record.status === 'pending' && record.expiresAt > now).map(draftOf)

/** The text the child receives: the chosen option, marked as the user's own decision. */
const inboxAnswerText = (option: ParentQuestionRecord['options'][number]): string => `${option.id}: ${option.label} (chosen by the user in the Inbox)`

const refused = (message: string): AttentionActOutcome => ({ ok: false, message })

const make = Effect.gen(function* () {
  const store = yield* QuestionStore
  const questions = yield* ParentQuestions
  const directory = yield* AgentDirectory
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)

  /** State every open child question to the inbox; questions that settled or expired resolve there. */
  const reconcile = Effect.fn('agent-questions attention reconcile')(function* () {
    if (!(yield* apis.isServed(attentionApi))) return
    const now = yield* Clock.currentTimeMillis
    const items = openDrafts(
      (yield* store.questions.entries).map(([, record]) => record),
      now,
    )
    yield* Effect.annotateCurrentSpan({ 'attention.items': items.length })
    yield* inbox.reconcile({ source: CHILD_QUESTION_SOURCE, items: [...items] })
  })

  const answer = Effect.fn('agent-questions attention answer')(function* (request: AttentionActRequest) {
    if (request.verb !== 'Answer') return refused('Subagent questions take Answer here; open the parent thread for anything else.')
    const record = (yield* store.questions.entries).map(([, row]) => row).find(row => row.questionId === request.item.dedupeKey)
    if (record === undefined) return refused('This question is no longer stored: it expired or was cleared. Mark the item done.')
    if (record.status !== 'pending') return refused(`This question is already ${record.status}; nothing is waiting for an answer.`)
    const option = record.options.find(candidate => candidate.id === request.choiceId)
    if (option === undefined) return refused('Pick one of the offered answers.')
    const parent = directory.liveAgent(record.parentSessionId)
    if (parent === undefined) {
      return refused('The parent thread is not running, so the subagent cannot receive an answer. Open the parent thread to resume it, then answer again.')
    }
    return yield* questions.answer({ agent: parent, questionId: record.questionId, answer: inboxAnswerText(option) }).pipe(
      Effect.as<AttentionActOutcome>({ ok: true, message: `Answered “${option.label}”. The subagent continues.` }),
      Effect.catch(error => Effect.succeed(refused(error.message))),
    )
  })

  yield* handleAttentionActs(request =>
    request.item.source === CHILD_QUESTION_SOURCE
      ? answer(request).pipe(Effect.catchCause(() => Effect.succeed(refused('Answering failed on the Host. Open the parent thread and answer there.'))))
      : Effect.succeed(undefined),
  )

  yield* Stream.mergeAll(
    [
      Stream.succeed(undefined),
      Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => undefined),
      store.changes,
      Stream.map(Stream.tick(RECONCILE_SAFETY_INTERVAL), () => undefined),
    ],
    { concurrency: 'unbounded' },
  ).pipe(
    Stream.debounce(RECONCILE_DEBOUNCE),
    Stream.runForEach(() => reconcile().pipe(Effect.catchCause(cause => Effect.logWarning('agent-questions: inbox reconcile failed', cause)))),
    DshxPlugin.detached,
    Effect.forkScoped,
  )
})

/** agent-questions as an inbox provider: pending child questions are blocking items, answerable from the Inbox. */
export class ChildQuestionAttention {
  static readonly layer = Layer.effectDiscard(make)
  static readonly openDrafts = openDrafts
  static readonly inboxAnswerText = inboxAnswerText
}
