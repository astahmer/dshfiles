import { describe, expect, it } from '@effect/vitest'
import { Clock, Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { SessionsUnavailable } from './errors.js'
import { StartRecovery } from './start-recovery.js'
import { StartIntentClaims, StartIntents, type StartIntent, type StartIntentDraft } from './start-intents.js'
import { BacklogStore } from './store.js'
import { backlogDbLayer, backlogRows, backlogStoreLayer, type BacklogTestRows } from './test-support.js'
import { ThreadStart, type StartThreadResult } from './thread-start.js'

type Resume = (intent: StartIntent) => Effect.Effect<StartThreadResult, SessionsUnavailable>

const fakeThreads = (resume: Resume) =>
  Layer.succeed(
    ThreadStart,
    ThreadStart.of({
      start: () => Effect.die('the recovery sweep never starts a thread itself'),
      resume,
      continuationCandidates: () => Effect.die('the recovery sweep never lists continuations'),
      continueThread: () => Effect.die('the recovery sweep never queues a continuation'),
    }),
  )

const openRecovery = (input: { readonly resume: Resume; readonly rows?: BacklogTestRows | undefined }) => {
  const rows = input.rows ?? backlogRows()
  return Layer.build(
    StartRecovery.layer.pipe(
      Layer.provideMerge(fakeThreads(input.resume)),
      Layer.provideMerge(Layer.mergeAll(StartIntentClaims.layer, StartIntents.layer.pipe(Layer.provideMerge(backlogDbLayer(rows))))),
      Layer.provideMerge(backlogStoreLayer({ rows })),
    ),
  ).pipe(
    Effect.map(context => ({
      recovery: Context.get(context, StartRecovery),
      intents: Context.get(context, StartIntents),
      store: Context.get(context, BacklogStore),
    })),
  )
}

/** The plugin loop over a log whose `stale` reads are counted: one read per recovery pass. */
const openLoop = (input: { readonly resume: Resume }) => {
  const rows = backlogRows()
  const passes = { count: 0 }
  const countedIntents = Layer.effect(
    StartIntents,
    Effect.gen(function* () {
      const intents = yield* StartIntents
      return StartIntents.of({ ...intents, stale: query => Effect.andThen(Effect.sync(() => (passes.count += 1)), intents.stale(query)) })
    }),
  ).pipe(Layer.provide(StartIntents.layer), Layer.provideMerge(backlogDbLayer(rows)))
  return Layer.build(
    StartRecovery.loop.pipe(
      Layer.provideMerge(StartRecovery.layer),
      Layer.provideMerge(fakeThreads(input.resume)),
      Layer.provideMerge(Layer.mergeAll(StartIntentClaims.layer, countedIntents)),
      Layer.provideMerge(backlogStoreLayer({ rows })),
    ),
  ).pipe(Effect.map(context => ({ passes, intents: Context.get(context, StartIntents), store: Context.get(context, BacklogStore) })))
}

const draft = (itemIds: readonly number[]): StartIntentDraft => ({
  id: 'start-1',
  promptRequestId: 'request-1',
  itemIds,
  agent: 'dsh',
  agentPreset: null,
  create: { workspaceId: 'workspace-1' },
  route: null,
  message: null,
  actor: { kind: 'user' },
})

/** A start recorded a minute ago and untouched since, the shape a Host death leaves behind. */
const staleStart = (intents: StartIntents['Service'], itemIds: readonly number[]) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis
    yield* intents.record(draft(itemIds), now - 60_000)
    yield* intents.touch('start-1', now - 45_001)
    return now
  })

const succeeding =
  (resumed: string[]): Resume =>
  intent =>
    Effect.sync(() => {
      resumed.push(intent.id)
      return { sessionId: 'session-9', linked: [...intent.itemIds], missing: [] }
    })

describe('thread start recovery', () => {
  it.effect('finishes a stale start, clears it from the log and leaves nothing on the item', () =>
    Effect.gen(function* () {
      const resumed: string[] = []
      const { recovery, intents, store } = yield* openRecovery({ resume: succeeding(resumed) })
      const captured = yield* store.capture({ text: 'bug: composer drops chips', actor: { kind: 'user' } })
      const itemId = captured.item.id
      yield* staleStart(intents, [itemId])

      expect(yield* recovery.sweep).toBe(1)
      expect(resumed).toEqual(['start-1'])
      expect(yield* intents.find('start-1')).toBeNull()
      const detail = yield* store.get(itemId)
      expect(detail.ok && detail.value.item.attention).toBeUndefined()
    }),
  )

  it.effect('leaves a start a live Host is still refreshing alone', () =>
    Effect.gen(function* () {
      const resumed: string[] = []
      const { recovery, intents, store } = yield* openRecovery({ resume: succeeding(resumed) })
      const captured = yield* store.capture({ text: 'bug: composer drops chips', actor: { kind: 'user' } })
      const now = yield* Clock.currentTimeMillis
      yield* intents.record(draft([captured.item.id]), now)

      expect(yield* recovery.sweep).toBe(0)
      expect(resumed).toEqual([])
      expect(yield* intents.find('start-1')).not.toBeNull()
    }),
  )

  it.effect('waits out one failure, then hands the start back to the person on its item', () =>
    Effect.gen(function* () {
      const { recovery, intents, store } = yield* openRecovery({ resume: () => Effect.fail(new SessionsUnavailable({})) })
      const captured = yield* store.capture({ text: 'bug: composer drops chips', actor: { kind: 'user' } })
      const itemId = captured.item.id
      const now = yield* staleStart(intents, [itemId])

      expect(yield* recovery.sweep).toBe(0)
      const waiting = yield* intents.find('start-1')
      expect(waiting?.attempts).toBe(1)
      expect(waiting?.lastError).toBe(new SessionsUnavailable({}).message)
      expect(waiting?.updatedAt).toBeGreaterThanOrEqual(now)

      // A start that already used its attempts is reported instead of retried, and its row goes away.
      yield* intents.attempted({ id: 'start-1', attempts: 2, lastError: 'still failing', now: now - 45_001 })
      expect(yield* recovery.sweep).toBe(0)
      expect(yield* intents.find('start-1')).toBeNull()
      const detail = yield* store.get(itemId)
      expect(detail.ok && detail.value.item.attention).toBe('blocked')
      const reported = detail.ok ? detail.value.item.events.filter(event => event.kind === 'commented') : []
      expect(reported.some(event => event.detail.includes('never did'))).toBe(true)
    }),
  )

  it.effect('stops querying an empty log after the boot pass and wakes when a start is recorded', () =>
    Effect.gen(function* () {
      const resumed: string[] = []
      const { passes, intents, store } = yield* openLoop({ resume: succeeding(resumed) })

      yield* TestClock.adjust('10 seconds')
      expect(passes.count).toBe(1)
      yield* TestClock.adjust('10 minutes')
      expect(passes.count).toBe(1)

      const captured = yield* store.capture({ text: 'bug: composer drops chips', actor: { kind: 'user' } })
      yield* staleStart(intents, [captured.item.id])
      yield* TestClock.adjust('20 seconds')
      expect(passes.count).toBe(2)
      expect(resumed).toEqual(['start-1'])
      yield* TestClock.adjust('10 minutes')
      expect(passes.count).toBe(2)
    }),
  )

  it.effect('retries a start a Host restart interrupted until it finishes, then parks', () =>
    Effect.gen(function* () {
      const attempts: string[] = []
      const { passes, intents, store } = yield* openLoop({
        resume: intent =>
          attempts.push(intent.id) === 1 ? Effect.fail(new SessionsUnavailable({})) : Effect.succeed({ sessionId: 'session-9', linked: [...intent.itemIds], missing: [] }),
      })
      const captured = yield* store.capture({ text: 'bug: composer drops chips', actor: { kind: 'user' } })
      yield* staleStart(intents, [captured.item.id])

      yield* TestClock.adjust('10 seconds')
      expect(attempts).toEqual(['start-1'])
      expect((yield* intents.find('start-1'))?.attempts).toBe(1)

      yield* TestClock.adjust('60 seconds')
      expect(attempts).toEqual(['start-1', 'start-1'])
      expect(yield* intents.find('start-1')).toBeNull()

      const settled = passes.count
      yield* TestClock.adjust('10 minutes')
      expect(passes.count).toBe(settled)
    }),
  )
})
