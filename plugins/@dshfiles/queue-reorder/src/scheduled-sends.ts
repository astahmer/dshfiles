import { randomUUID } from 'node:crypto'
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Schema, Stream } from 'effect'
import { MAX_SCHEDULE_AHEAD_MS, type ScheduledSend, type SendModel } from './scheduled-send-api.js'
import { newSendId, ScheduledSendStore } from './scheduled-send-store.js'

/** A busy thread or a Host that cannot reach the thread yet is tried again this much later. */
export const RETRY_DELAY_MS = 30_000
/** Failed deliveries before a send stops retrying and asks the user. */
export const MAX_ATTEMPTS = 5
/** The loop sleeps at most this long, so a clock jump or a missed wake-up is caught within a minute. */
const MAX_SLEEP_MS = 60_000

/** What one delivery attempt did. */
export type DeliveryOutcome =
  | { readonly kind: 'sent' }
  /** Not sent yet, for a reason that clears by itself (a queue that must settle before a model switch). */
  | { readonly kind: 'wait'; readonly note: string }
  /** Not sent; `retryable` false means trying again cannot help until the user changes something. */
  | { readonly kind: 'failed'; readonly note: string; readonly retryable: boolean }

/**
 * How a send reaches its thread: switch the model when it names one, then prompt with the send's request id. The
 * request id makes the prompt idempotent, so a retry after a crash never adds the message twice.
 */
export class ScheduledSendDelivery extends Context.Service<
  ScheduledSendDelivery,
  { readonly deliver: (send: ScheduledSend) => Effect.Effect<DeliveryOutcome> }
>()('@dshfiles/queue-reorder/ScheduledSendDelivery') {}

/** A request the user can correct: a past time, an unknown send. */
export class ScheduledSendRefused extends Schema.TaggedError<ScheduledSendRefused>()(
  'ScheduledSendRefused',
  { reason: Schema.String },
  { dshxWireCode: 'scheduled-send-refused' },
) {
  override get message(): string {
    return this.reason
  }
}

const checkTime = (sendAt: number, now: number): Effect.Effect<void, ScheduledSendRefused> => {
  if (sendAt <= now)
    return Effect.fail(new ScheduledSendRefused({ reason: 'That time has already passed. Pick a time in the future, or send the message now.' }))
  if (sendAt - now > MAX_SCHEDULE_AHEAD_MS) return Effect.fail(new ScheduledSendRefused({ reason: 'Pick a time within the next year.' }))
  return Effect.void
}

const notFound = (id: string) =>
  new ScheduledSendRefused({ reason: `No scheduled message ${id} exists; it was sent or cancelled. List the scheduled messages to see what is left.` })

/** The earliest moment a send may go out: its time, or its retry when that is later. */
const dueAt = (send: ScheduledSend): number => Math.max(send.sendAt, send.retryAt ?? 0)

const withoutRetry = (send: ScheduledSend): ScheduledSend => {
  const { retryAt: _retryAt, note: _note, ...rest } = send
  return rest
}

const make = Effect.gen(function* () {
  const store = yield* ScheduledSendStore
  const delivery = yield* ScheduledSendDelivery

  const list = Effect.fn('scheduled send list')(function* (input: { readonly sessionId?: string | undefined }) {
    const sends = yield* store.all
    return { sends: input.sessionId === undefined ? sends : sends.filter(send => send.sessionId === input.sessionId) }
  })

  const create = Effect.fn('scheduled send create')(function* (input: {
    readonly sessionId: string
    readonly text: string
    readonly sendAt: number
    readonly model?: SendModel | undefined
  }) {
    const now = yield* Clock.currentTimeMillis
    yield* checkTime(input.sendAt, now)
    const send: ScheduledSend = {
      id: newSendId(),
      sessionId: input.sessionId,
      text: input.text,
      sendAt: input.sendAt,
      ...(input.model === undefined ? {} : { model: input.model }),
      createdAt: now,
      status: 'scheduled',
      requestId: randomUUID(),
      attempts: 0,
    }
    yield* store.exclusive(store.put(send))
    yield* Effect.annotateCurrentSpan({ 'dshx.scheduled_send.id': send.id, 'dsh.session.id': send.sessionId })
    return send
  })

  const update = Effect.fn('scheduled send update')(function* (input: {
    readonly id: string
    readonly text?: string | undefined
    readonly sendAt?: number | undefined
    readonly model?: SendModel | null | undefined
  }) {
    const now = yield* Clock.currentTimeMillis
    if (input.sendAt !== undefined) yield* checkTime(input.sendAt, now)
    return yield* store.exclusive(
      Effect.gen(function* () {
        const current = Option.getOrUndefined(yield* store.get(input.id))
        if (current === undefined) return yield* notFound(input.id)
        if (current.status === 'sending')
          return yield* new ScheduledSendRefused({ reason: 'This message is being sent right now and can no longer be changed.' })
        const base = withoutRetry(current)
        const { model: _model, ...withoutModel } = base
        const modelled = input.model === undefined ? base : input.model === null ? withoutModel : { ...withoutModel, model: input.model }
        const next: ScheduledSend = {
          ...modelled,
          ...(input.text === undefined ? {} : { text: input.text }),
          sendAt: input.sendAt ?? (current.status === 'failed' ? Math.max(current.sendAt, now) : current.sendAt),
          status: 'scheduled',
          attempts: 0,
        }
        yield* store.put(next)
        return next
      }),
    )
  })

  const cancel = Effect.fn('scheduled send cancel')(function* (input: { readonly id: string }) {
    return yield* store.exclusive(
      Effect.gen(function* () {
        const current = Option.getOrUndefined(yield* store.get(input.id))
        if (current === undefined) return yield* notFound(input.id)
        if (current.status === 'sending')
          return yield* new ScheduledSendRefused({ reason: 'This message is being sent right now and can no longer be cancelled.' })
        yield* store.remove(input.id)
        return current
      }),
    )
  })

  /**
   * Claim one due send, deliver it and settle it. The claim (`sending`) is committed first; a Host that stops during
   * delivery finds it on the next tick and delivers again under the same request id, which the thread ignores when it
   * already holds that message.
   */
  const deliverOne = Effect.fn('scheduled send deliver')(function* (id: string, now: number) {
    const claimed = yield* store.exclusive(
      Effect.gen(function* () {
        const current = Option.getOrUndefined(yield* store.get(id))
        if (current === undefined || current.status === 'failed') return undefined
        const sending: ScheduledSend = { ...current, status: 'sending', attempts: current.attempts + 1 }
        yield* store.put(sending)
        return sending
      }),
    )
    if (claimed === undefined) return undefined
    yield* Effect.annotateCurrentSpan({
      'dshx.scheduled_send.id': claimed.id,
      'dsh.session.id': claimed.sessionId,
      'dshx.scheduled_send.attempt': claimed.attempts,
    })
    const outcome = yield* delivery.deliver(claimed)
    yield* Effect.annotateCurrentSpan({ 'dshx.scheduled_send.outcome': outcome.kind })
    yield* store.exclusive(
      Effect.gen(function* () {
        if (outcome.kind === 'sent') {
          yield* store.remove(claimed.id)
          return
        }
        const retry = outcome.kind === 'wait' || (outcome.retryable && claimed.attempts < MAX_ATTEMPTS)
        const settled: ScheduledSend = retry
          ? {
              ...claimed,
              status: 'scheduled',
              note: outcome.note,
              retryAt: now + RETRY_DELAY_MS,
              ...(outcome.kind === 'wait' ? { attempts: claimed.attempts - 1 } : {}),
            }
          : { ...withoutRetry(claimed), status: 'failed', note: outcome.note }
        yield* store.put(settled)
      }),
    )
    return outcome
  })

  /** Deliver every send due at `now`, one at a time, soonest first. */
  const tick = Effect.fn('scheduled send tick')(function* (now: number) {
    const due = (yield* store.all).filter(send => send.status !== 'failed' && dueAt(send) <= now)
    return yield* Effect.forEach(due, send => deliverOne(send.id, now))
  })

  const sendNow = Effect.fn('scheduled send now')(function* (input: { readonly id: string }) {
    const now = yield* Clock.currentTimeMillis
    const moved = yield* store.exclusive(
      Effect.gen(function* () {
        const current = Option.getOrUndefined(yield* store.get(input.id))
        if (current === undefined) return yield* notFound(input.id)
        if (current.status === 'sending') return current
        const next: ScheduledSend = { ...withoutRetry(current), sendAt: Math.min(current.sendAt, now), status: 'scheduled', attempts: 0 }
        yield* store.put(next)
        return next
      }),
    )
    return moved
  })

  /** Milliseconds until the earliest pending send, capped at MAX_SLEEP_MS. */
  const untilNext = Effect.fn('scheduled send next')(function* (now: number) {
    let wait = MAX_SLEEP_MS
    for (const send of yield* store.all) if (send.status !== 'failed') wait = Math.min(wait, Math.max(0, dueAt(send) - now))
    return wait
  })

  return { list, create, update, cancel, sendNow, tick, untilNext }
})

/** The scheduled sends' verbs; the API, the agent tools and the scheduler loop share them. */
export class ScheduledSends extends Context.Service<ScheduledSends, Effect.Success<typeof make>>()('@dshfiles/queue-reorder/ScheduledSends') {
  static readonly layer = Layer.effect(ScheduledSends, make)
}

/**
 * The plugin's `main`: deliver what is due, then sleep until the next send or until a send changes (a new one, an
 * edit, Send now), whichever comes first. A failed tick is logged and retried on the next wake.
 */
export const runScheduledSends = Effect.gen(function* () {
  const sends = yield* ScheduledSends
  const store = yield* ScheduledSendStore
  const wake = yield* Queue.sliding<void>(1)
  yield* Effect.forkScoped(Stream.runForEach(store.changes, () => Queue.offer(wake, undefined)))
  for (;;) {
    const now = yield* Clock.currentTimeMillis
    yield* sends.tick(now).pipe(Effect.catchCause(cause => Effect.logWarning('queue-reorder: scheduled send tick failed', cause)))
    const wait = yield* sends.untilNext(yield* Clock.currentTimeMillis).pipe(Effect.orElseSucceed(() => MAX_SLEEP_MS))
    yield* Effect.raceFirst(Effect.sleep(Duration.millis(Math.max(wait, 250))), Queue.take(wake))
    yield* Effect.sleep(Duration.millis(50))
  }
})
