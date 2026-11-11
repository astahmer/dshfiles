import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Ref, SubscriptionRef } from 'effect'
import { jsonStorageDomain } from './storage.test-support.js'
import { ThreadSubscriptions } from './subscriptions-store.js'
import type { ThreadSubscription } from './subscriptions-api.js'
import {
  SubscriptionNoticeModel,
  makeSubscriptionNoticeTracker,
  notifySubscribers,
  type DeliveryOutcome,
  type FinishedTurn,
  type SessionEventReport,
  type SubscriptionEdges,
  type DeliveryMode,
  type SubscriptionFinish,
  type SubscriptionTargetState,
} from './subscription-notices.js'
import type { SubscriptionDeliveryMode, SubscriptionNoticeLevel } from './subscription-levels.js'

const finished = (finish: SubscriptionFinish): FinishedTurn => ({ finish, endSeq: 100, observed: undefined })

const turnEnd = (kind: string, reason?: string) => ({
  type: 'turn/end',
  seq: 12,
  time: 1_000,
  data: { turn: 3, reason: reason === undefined ? { kind } : { kind, reason: { kind: reason } } },
})

const edge = (subscriberSessionId: string, targetSessionId = 'target', level?: SubscriptionNoticeLevel): ThreadSubscription => ({
  subscriberSessionId,
  targetSessionId,
  createdAt: 1,
  ...(level === undefined ? {} : { level }),
})

/** The subscription store as the notifier reads it, remembering what a pass pruned. */
const fakeEdges = (rows: ReadonlyArray<ThreadSubscription>) =>
  Effect.gen(function* () {
    const pruned = yield* SubscriptionRef.make<ReadonlyArray<string>>([])
    const removed = yield* SubscriptionRef.make<ReadonlyArray<string>>([])
    const store: SubscriptionEdges = {
      edgesFor: targetSessionId => Effect.succeed(rows.filter(row => row.targetSessionId === targetSessionId)),
      prune: sessionIds =>
        Effect.gen(function* () {
          yield* SubscriptionRef.update(pruned, current => [...current, ...sessionIds])
          return rows.filter(row => sessionIds.has(row.subscriberSessionId) || sessionIds.has(row.targetSessionId)).length
        }),
      unsubscribe: input =>
        Effect.gen(function* () {
          yield* SubscriptionRef.update(removed, current => [...current, input.subscriberSessionId])
          return { subscriptions: [] }
        }),
    }
    return { store, pruned, removed }
  })

const fakeNotices = (input: {
  readonly states: ReadonlyMap<string, SubscriptionTargetState>
  readonly entries?: ReadonlyArray<{ readonly role: string; readonly text: string; readonly seq?: number }>
  readonly outcome?: DeliveryOutcome
  /** What a steer answers; a refused steer is how a compacting or racing Host shows. */
  readonly steerOutcome?: DeliveryOutcome
  readonly landed?: boolean
  readonly level?: SubscriptionNoticeLevel
  readonly delivery?: SubscriptionDeliveryMode
}) =>
  Effect.gen(function* () {
    const delivered = yield* Ref.make<ReadonlyArray<{ readonly sessionId: string; readonly text: string; readonly mode: DeliveryMode }>>([])
    const transcriptReads = yield* Ref.make(0)
    return {
      delivered,
      transcriptReads,
      notices: {
        landedSince: () => Effect.succeed(input.landed ?? false),
        defaultLevel: Effect.succeed(input.level ?? 'all'),
        deliveryMode: Effect.succeed(input.delivery ?? 'steer'),
        stateOf: (_sessionIds: ReadonlyArray<string>) => Effect.succeed(input.states),
        deliver: (request: { readonly sessionId: string; readonly text: string; readonly mode: DeliveryMode }) =>
          Effect.gen(function* () {
            if (input.outcome !== undefined && !input.outcome.delivered) return input.outcome
            if (request.mode === 'steer' && input.steerOutcome !== undefined && !input.steerOutcome.delivered) return input.steerOutcome
            yield* Ref.update(delivered, current => [...current, request])
            return { delivered: true } as DeliveryOutcome
          }),
        messagesOf: () =>
          Effect.as(
            Ref.update(transcriptReads, count => count + 1),
            input.entries ?? [],
          ),
      },
    }
  })

const state = (overrides: Partial<SubscriptionTargetState> = {}): SubscriptionTargetState => ({
  archived: false,
  pendingQuestions: 0,
  title: 'Fix the parser',
  ...overrides,
})

/** The real subscription store on a temporary storage root, so an unsubscribe is the store's own. */
const withSubscriptions = <A, E>(body: (root: string) => Effect.Effect<A, E, ThreadSubscriptions>) =>
  Effect.gen(function* () {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'thread-subscription-notices-' })
    return yield* body(root).pipe(Effect.provide(ThreadSubscriptions.layer.pipe(Layer.provide(jsonStorageDomain(root)))))
  }).pipe(Effect.provide(NodeFileSystem.layer))

describe('thread subscription notices', () => {
  it('only a real completion is reported', () => {
    expect(SubscriptionNoticeModel.finishOf(turnEnd('completed'))).toBe('completed')
    expect(SubscriptionNoticeModel.finishOf(turnEnd('error'))).toBe('error')
    expect(SubscriptionNoticeModel.finishOf(turnEnd('max-tokens'))).toBe('max-tokens')
    expect(SubscriptionNoticeModel.finishOf(turnEnd('aborted'))).toBe('aborted')
    expect(SubscriptionNoticeModel.finishOf(turnEnd('aborted', 'disposed'))).toBe(null)
    expect(SubscriptionNoticeModel.finishOf(turnEnd('forked'))).toBe(null)
    expect(SubscriptionNoticeModel.finishOf(turnEnd('interrupted'))).toBe(null)
    expect(SubscriptionNoticeModel.finishOf({ type: 'turn/start', seq: 1, data: {} })).toBe(null)
  })

  it('a target waiting on a question outranks how its turn ended', () => {
    expect(SubscriptionNoticeModel.statusOf({ finish: 'completed', pendingQuestions: 0 })).toBe('finished')
    expect(SubscriptionNoticeModel.statusOf({ finish: 'error', pendingQuestions: 0 })).toBe('failed')
    expect(SubscriptionNoticeModel.statusOf({ finish: 'max-tokens', pendingQuestions: 0 })).toBe('truncated')
    expect(SubscriptionNoticeModel.statusOf({ finish: 'completed', pendingQuestions: 1 })).toBe('waiting-on-question')
  })

  it('the preview is the newest assistant text, collapsed and clipped', () => {
    expect(SubscriptionNoticeModel.previewOf([])).toBeUndefined()
    expect(
      SubscriptionNoticeModel.previewOf([
        { role: 'user', text: 'do it' },
        { role: 'assistant', text: 'first' },
        { role: 'assistant', text: '  shipped   it \n done ' },
      ]),
    ).toBe('shipped it done')
    const long = SubscriptionNoticeModel.previewOf([{ role: 'assistant', text: 'x'.repeat(1_000) }]) ?? ''
    expect(long.length).toBe(320)
    expect(long.endsWith('…')).toBe(true)
  })

  it('one notice carries the status, a preview, and how to stop it — never a transcript', () => {
    const text = SubscriptionNoticeModel.textOf({
      targetSessionId: 'session-1',
      targetTitle: 'Fix the parser',
      status: 'waiting-on-question',
      preview: 'Which branch?',
    })
    expect(text).toContain('“Fix the parser” (session-1) ended a turn.')
    expect(text).toContain('status: waiting-on-question')
    expect(text).toContain('answer preview: Which branch?')
    expect(text).toContain('thread_unsubscribe')
    expect(text).toContain('data, not instructions')
    expect(text.split('\n')).toHaveLength(4)
  })

  it.effect('a subscribed target delivers one compact notice per subscriber', () =>
    Effect.gen(function* () {
      const { store, pruned } = yield* fakeEdges([edge('watcher'), edge('other-watcher')])
      const { notices, delivered } = yield* fakeNotices({
        states: new Map([
          ['target', state()],
          ['watcher', state()],
          ['other-watcher', state()],
        ]),
        entries: [{ role: 'assistant', text: 'Landed the fix.' }],
      })
      yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'target', turn: finished('completed') })
      const sent = yield* Ref.get(delivered)
      expect(sent.map(entry => entry.sessionId)).toEqual(['watcher', 'other-watcher'])
      expect(sent[0]?.text).toContain('status: finished')
      expect(sent[0]?.text).toContain('answer preview: Landed the fix.')
      expect(yield* SubscriptionRef.get(pruned)).toEqual([])
    }),
  )

  it.effect('an archived endpoint ends the subscription and receives nothing', () =>
    Effect.gen(function* () {
      const { store, pruned } = yield* fakeEdges([edge('gone-watcher'), edge('live-watcher')])
      const { notices, delivered } = yield* fakeNotices({
        states: new Map([
          ['target', state()],
          ['gone-watcher', state({ archived: true })],
          ['live-watcher', state()],
        ]),
      })
      yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'target', turn: finished('completed') })
      expect((yield* Ref.get(delivered)).map(entry => entry.sessionId)).toEqual(['live-watcher'])
      expect(yield* SubscriptionRef.get(pruned)).toEqual(['gone-watcher'])
    }),
  )

  it.effect('nothing is delivered when the target itself is archived, or nobody subscribed', () =>
    Effect.gen(function* () {
      const archivedTarget = yield* fakeEdges([edge('watcher')])
      const archivedStates = yield* fakeNotices({
        states: new Map([
          ['target', state({ archived: true })],
          ['watcher', state()],
        ]),
      })
      yield* notifySubscribers({
        notices: archivedStates.notices,
        subscriptions: archivedTarget.store,
        targetSessionId: 'target',
        turn: finished('completed'),
      })
      expect(yield* Ref.get(archivedStates.delivered)).toEqual([])
      expect(yield* SubscriptionRef.get(archivedTarget.pruned)).toEqual(['target'])

      const noEdges = yield* fakeEdges([])
      const unused = yield* fakeNotices({ states: new Map() })
      yield* notifySubscribers({ notices: unused.notices, subscriptions: noEdges.store, targetSessionId: 'target', turn: finished('completed') })
      expect(yield* Ref.get(unused.delivered)).toEqual([])
    }),
  )

  it.effect('one subscription delivers exactly one notice per finish, and none once unsubscribed', () =>
    withSubscriptions(() =>
      Effect.gen(function* () {
        const subscriptions = yield* ThreadSubscriptions
        const { notices, delivered } = yield* fakeNotices({
          states: new Map([
            ['target', state()],
            ['watcher', state()],
          ]),
          entries: [{ role: 'assistant', text: 'Landed the fix.' }],
        })

        yield* subscriptions.subscribe({ subscriberSessionId: 'watcher', targetSessionId: 'target' })
        yield* notifySubscribers({ notices, subscriptions, targetSessionId: 'target', turn: finished('completed') })
        expect(yield* Ref.get(delivered)).toHaveLength(1)

        yield* subscriptions.unsubscribe({ subscriberSessionId: 'watcher', targetSessionId: 'target' })
        yield* notifySubscribers({ notices, subscriptions, targetSessionId: 'target', turn: finished('completed') })
        expect(yield* Ref.get(delivered)).toHaveLength(1)
      }),
    ),
  )

  it.effect('a subscriber the Host no longer resolves loses its edge instead of retrying forever', () =>
    Effect.gen(function* () {
      const { store, removed } = yield* fakeEdges([edge('deleted-watcher')])
      const { notices } = yield* fakeNotices({
        states: new Map([
          ['target', state()],
          ['deleted-watcher', state()],
        ]),
        outcome: { delivered: false, code: 'thread-not-found', detail: 'No thread with that id exists.' },
      })
      yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'target', turn: finished('error') })
      expect(yield* SubscriptionRef.get(removed)).toEqual(['deleted-watcher'])
    }),
  )
  describe('the tracker', () => {
    let seq = 0
    const at = (sessionId: string, type: string, data: unknown = {}): { readonly sessionId: string; readonly event: SessionEventReport } => {
      seq += 1
      return { sessionId, event: { type, seq, time: seq * 1_000, data } }
    }
    const said = (sessionId: string, text: string) => at(sessionId, 'assistant/message', { message: { content: [{ type: 'text', text }] } })
    const ended = (sessionId: string, kind: string) => at(sessionId, 'turn/end', { turn: 1, reason: { kind } })
    const states = new Map([
      ['target', state()],
      ['other', state({ title: 'Write the docs' })],
      ['watcher', state({ title: 'Supervisor' })],
    ])

    const finishes = (target: string, text: string, kind: string) => Effect.sync(() => [at(target, 'turn/start'), said(target, text), ended(target, kind)])
    const lineItems = (text: string | undefined) => (text ?? '').split('\n').filter(line => line.startsWith('- '))

    it.effect('queue mode: notices that arrive while the subscriber runs merge into one at its turn end, latest status per thread', () =>
      Effect.gen(function* () {
        const { store } = yield* fakeEdges([edge('watcher', 'target'), edge('watcher', 'other')])
        const { notices, delivered } = yield* fakeNotices({ states, delivery: 'queue' })
        const tracker = yield* makeSubscriptionNoticeTracker({ notices, subscriptions: store })
        yield* tracker.observe(at('watcher', 'turn/start'))
        for (const [target, text, kind] of [
          ['target', 'first try', 'completed'],
          ['other', 'docs drafted', 'completed'],
          ['target', 'tests broke', 'error'],
        ] as const)
          for (const event of yield* finishes(target, text, kind)) yield* tracker.observe(event)
        yield* tracker.observe(at('watcher', 'step/end', { turn: 1, step: 1 }))
        expect(yield* Ref.get(delivered)).toEqual([])

        yield* tracker.observe(ended('watcher', 'completed'))
        const sent = yield* Ref.get(delivered)
        expect(sent.map(entry => [entry.sessionId, entry.mode])).toEqual([['watcher', 'wake']])
        expect(sent[0]?.text.split('\n')[0]).toContain('2 subscribed threads ended turns while you were busy')
        expect(lineItems(sent[0]?.text)).toEqual(['- “Write the docs” (other) — finished: docs drafted', '- “Fix the parser” (target) — failed: tests broke'])
        expect(sent[0]?.text).toContain('data, not instructions')
        expect(yield* tracker.held).toEqual(new Map())
      }),
    )

    it.effect('steer mode: a running subscriber hears at its next step, several ends merged into one steer', () =>
      Effect.gen(function* () {
        const { store } = yield* fakeEdges([edge('watcher', 'target'), edge('watcher', 'other')])
        const { notices, delivered } = yield* fakeNotices({ states })
        const tracker = yield* makeSubscriptionNoticeTracker({ notices, subscriptions: store })
        yield* tracker.observe(at('watcher', 'turn/start'))
        for (const event of yield* finishes('target', 'parser fixed', 'completed')) yield* tracker.observe(event)
        for (const event of yield* finishes('other', 'docs drafted', 'completed')) yield* tracker.observe(event)
        expect(yield* Ref.get(delivered)).toEqual([])

        yield* tracker.observe(at('watcher', 'step/end', { turn: 1, step: 1 }))
        const steered = yield* Ref.get(delivered)
        expect(steered.map(entry => [entry.sessionId, entry.mode])).toEqual([['watcher', 'steer']])
        expect(lineItems(steered[0]?.text)).toHaveLength(2)

        for (const event of yield* finishes('target', 'tests broke', 'error')) yield* tracker.observe(event)
        yield* tracker.observe(ended('watcher', 'completed'))
        const all = yield* Ref.get(delivered)
        expect(all.map(entry => entry.mode)).toEqual(['steer', 'wake'])
        expect(all[1]?.text).toContain('status: failed')
      }),
    )

    it.effect('a refused steer falls back to one queued notice at the turn end, merged with what arrived meanwhile', () =>
      Effect.gen(function* () {
        const { store } = yield* fakeEdges([edge('watcher', 'target'), edge('watcher', 'other')])
        const { notices, delivered } = yield* fakeNotices({
          states,
          steerOutcome: { delivered: false, code: 'compaction-running', detail: 'The thread is compacting.' },
        })
        const tracker = yield* makeSubscriptionNoticeTracker({ notices, subscriptions: store })
        yield* tracker.observe(at('watcher', 'turn/start'))
        for (const event of yield* finishes('target', 'parser fixed', 'completed')) yield* tracker.observe(event)
        yield* tracker.observe(at('watcher', 'step/end', { turn: 1, step: 1 }))
        expect(yield* Ref.get(delivered)).toEqual([])
        expect([...((yield* tracker.held).get('watcher')?.keys() ?? [])]).toEqual(['target'])

        for (const event of yield* finishes('other', 'docs drafted', 'completed')) yield* tracker.observe(event)
        yield* tracker.observe(ended('watcher', 'completed'))
        const sent = yield* Ref.get(delivered)
        expect(sent.map(entry => entry.mode)).toEqual(['wake'])
        expect(lineItems(sent[0]?.text)).toHaveLength(2)
      }),
    )

    it.effect('an idle subscriber is woken at once; the next end before its turn starts joins that turn instead of queueing', () =>
      Effect.gen(function* () {
        const { store } = yield* fakeEdges([edge('watcher', 'target'), edge('watcher', 'other')])
        const { notices, delivered } = yield* fakeNotices({ states })
        const tracker = yield* makeSubscriptionNoticeTracker({ notices, subscriptions: store })
        for (const event of yield* finishes('target', 'done', 'completed')) yield* tracker.observe(event)
        expect((yield* Ref.get(delivered)).map(entry => [entry.mode, entry.text.split('\n')[1]])).toEqual([['wake', 'status: finished']])

        for (const event of yield* finishes('other', 'docs drafted', 'completed')) yield* tracker.observe(event)
        expect(yield* Ref.get(delivered)).toHaveLength(1)
        yield* tracker.observe(at('watcher', 'turn/start'))
        yield* tracker.observe(at('watcher', 'step/end', { turn: 1, step: 1 }))
        const sent = yield* Ref.get(delivered)
        expect(sent.map(entry => entry.mode)).toEqual(['wake', 'steer'])
        expect(sent[1]?.text).toContain('answer preview: docs drafted')
      }),
    )

    it.effect('a compaction-only turn does not notify; a turn that also answered does', () =>
      Effect.gen(function* () {
        const { store } = yield* fakeEdges([edge('watcher')])
        const { notices, delivered } = yield* fakeNotices({ states })
        const tracker = yield* makeSubscriptionNoticeTracker({ notices, subscriptions: store })
        yield* tracker.observe(at('target', 'turn/start'))
        yield* tracker.observe(at('target', 'compaction/start', { turn: 1 }))
        yield* tracker.observe(at('target', 'compaction/end', { turn: 1 }))
        yield* tracker.observe(ended('target', 'completed'))
        expect(yield* Ref.get(delivered)).toEqual([])

        yield* tracker.observe(at('target', 'turn/start'))
        yield* tracker.observe(at('target', 'compaction/start', { turn: 2 }))
        yield* tracker.observe(at('target', 'compaction/end', { turn: 2 }))
        yield* tracker.observe(said('target', 'continued after compacting'))
        yield* tracker.observe(ended('target', 'completed'))
        expect((yield* Ref.get(delivered)).map(entry => entry.text)).toEqual([expect.stringContaining('answer preview: continued after compacting')])
      }),
    )

    it.effect('the preview quotes the turn that ended, without reading the transcript', () =>
      Effect.gen(function* () {
        const { store } = yield* fakeEdges([edge('watcher')])
        const { notices, delivered, transcriptReads } = yield* fakeNotices({
          states,
          entries: [{ role: 'assistant', text: 'a newer turn already answered this', seq: 999 }],
        })
        const tracker = yield* makeSubscriptionNoticeTracker({ notices, subscriptions: store })
        yield* tracker.observe(at('target', 'turn/start'))
        yield* tracker.observe(said('target', 'step one'))
        yield* tracker.observe(at('target', 'assistant/message', { message: { content: [{ type: 'reasoning', text: 'hidden' }] } }))
        yield* tracker.observe(said('target', 'the answer of this turn'))
        yield* tracker.observe(ended('target', 'completed'))
        expect((yield* Ref.get(delivered))[0]?.text).toContain('answer preview: the answer of this turn')
        expect(yield* Ref.get(transcriptReads)).toBe(0)
      }),
    )

    it('a transcript fallback never quotes a turn after the one that ended', () => {
      const entries = [
        { role: 'assistant', text: 'earlier turn', seq: 3 },
        { role: 'assistant', text: 'this turn', seq: 8 },
        { role: 'assistant', text: 'a later turn', seq: 12 },
      ]
      expect(SubscriptionNoticeModel.previewOf(entries, { endSeq: 10 })).toBe('this turn')
      expect(SubscriptionNoticeModel.previewOf(entries, { startSeq: 8, endSeq: 10 })).toBeUndefined()
    })

    it.effect('a level filters what reaches one subscription; the default level covers those that set none', () =>
      Effect.gen(function* () {
        const run = (input: {
          readonly kind: string
          readonly level?: SubscriptionNoticeLevel
          readonly defaultLevel?: SubscriptionNoticeLevel
          readonly landed?: boolean
          readonly pendingQuestions?: number
        }) =>
          Effect.gen(function* () {
            const { store } = yield* fakeEdges([edge('watcher', 'target', input.level)])
            const { notices, delivered } = yield* fakeNotices({
              states: new Map([
                ['target', state({ pendingQuestions: input.pendingQuestions ?? 0 })],
                ['watcher', state()],
              ]),
              ...(input.defaultLevel === undefined ? {} : { level: input.defaultLevel }),
              landed: input.landed ?? false,
            })
            const tracker = yield* makeSubscriptionNoticeTracker({ notices, subscriptions: store })
            for (const event of yield* finishes('target', 'text', input.kind)) yield* tracker.observe(event)
            return (yield* Ref.get(delivered)).map(entry => entry.text.split('\n')[1])
          })
        expect(yield* run({ kind: 'completed' })).toEqual(['status: finished'])
        expect(yield* run({ kind: 'completed', level: 'outcomes' })).toEqual([])
        expect(yield* run({ kind: 'aborted', level: 'outcomes' })).toEqual([])
        expect(yield* run({ kind: 'completed', level: 'outcomes', landed: true })).toEqual(['status: landed'])
        expect(yield* run({ kind: 'error', level: 'outcomes' })).toEqual(['status: failed'])
        expect(yield* run({ kind: 'completed', level: 'outcomes', pendingQuestions: 1 })).toEqual(['status: waiting-on-question'])
        expect(yield* run({ kind: 'completed', level: 'stuck', landed: true })).toEqual([])
        expect(yield* run({ kind: 'max-tokens', level: 'stuck' })).toEqual(['status: truncated'])
        expect(yield* run({ kind: 'blocked', level: 'stuck' })).toEqual(['status: blocked'])
        expect(yield* run({ kind: 'error', level: 'never' })).toEqual([])
        expect(yield* run({ kind: 'completed', defaultLevel: 'stuck' })).toEqual([])
        expect(yield* run({ kind: 'completed', defaultLevel: 'stuck', level: 'all' })).toEqual(['status: finished'])
      }),
    )
  })
})
