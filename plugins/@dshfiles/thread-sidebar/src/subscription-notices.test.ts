import { describe, expect, it } from '@effect/vitest'
import { Effect, Ref, SubscriptionRef } from 'effect'
import type { ThreadSubscription } from './subscriptions-api.js'
import {
  SubscriptionNoticeModel,
  notifySubscribers,
  type DeliveryOutcome,
  type SubscriptionEdges,
  type SubscriptionTargetState,
} from './subscription-notices.js'

const turnEnd = (kind: string, reason?: string): unknown => ({
  type: 'turn/end',
  seq: 12,
  time: 1_000,
  data: { turn: 3, reason: reason === undefined ? { kind } : { kind, reason: { kind: reason } } },
})

const edge = (subscriberSessionId: string, targetSessionId = 'target'): ThreadSubscription => ({ subscriberSessionId, targetSessionId, createdAt: 1 })

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
  readonly entries?: ReadonlyArray<{ readonly role: string; readonly text: string }>
  readonly outcome?: DeliveryOutcome
}) =>
  Effect.gen(function* () {
    const delivered = yield* Ref.make<ReadonlyArray<{ readonly sessionId: string; readonly text: string }>>([])
    return {
      delivered,
      notices: {
        stateOf: (_sessionIds: ReadonlyArray<string>) => Effect.succeed(input.states),
        deliver: (request: { readonly sessionId: string; readonly text: string }) =>
          Effect.gen(function* () {
            if (input.outcome !== undefined && !input.outcome.delivered) return input.outcome
            yield* Ref.update(delivered, current => [...current, request])
            return { delivered: true } as DeliveryOutcome
          }),
        messagesOf: () => Effect.succeed(input.entries ?? []),
      },
    }
  })

const state = (overrides: Partial<SubscriptionTargetState> = {}): SubscriptionTargetState => ({
  archived: false,
  pendingQuestions: 0,
  title: 'Fix the parser',
  ...overrides,
})

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
      yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'target', finish: 'completed' })
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
      yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'target', finish: 'completed' })
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
        finish: 'completed',
      })
      expect(yield* Ref.get(archivedStates.delivered)).toEqual([])
      expect(yield* SubscriptionRef.get(archivedTarget.pruned)).toEqual(['target'])

      const noEdges = yield* fakeEdges([])
      const unused = yield* fakeNotices({ states: new Map() })
      yield* notifySubscribers({ notices: unused.notices, subscriptions: noEdges.store, targetSessionId: 'target', finish: 'completed' })
      expect(yield* Ref.get(unused.delivered)).toEqual([])
    }),
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
      yield* notifySubscribers({ notices, subscriptions: store, targetSessionId: 'target', finish: 'error' })
      expect(yield* SubscriptionRef.get(removed)).toEqual(['deleted-watcher'])
    }),
  )
})
