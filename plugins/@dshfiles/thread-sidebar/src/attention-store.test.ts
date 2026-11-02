import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import type { ThreadAttentionView } from './attention-api.js'
import { ThreadAttention, ThreadAttentionStoreModel } from './attention-store.js'
import { jsonStorageDomain } from './storage.test-support.js'

const attentionAt = (root: string) => ThreadAttention.layer.pipe(Layer.provide(jsonStorageDomain(root)))

/** Run with a fresh storage root, the clock at `now`, and the store built after the clock is set. */
const withAttention = <A, E>(now: number, body: (root: string) => Effect.Effect<A, E, ThreadAttention>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(now)
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'thread-attention-' })
    return yield* body(root).pipe(Effect.provide(attentionAt(root)))
  }).pipe(Effect.provide(NodeFileSystem.layer))

/** The rows a fresh store over the same root reads back: what is durable. */
const durableRows = (root: string) =>
  Effect.map(
    ThreadAttention.use(attention => attention.snapshot),
    snapshot => snapshot.sessions,
  ).pipe(Effect.provide(attentionAt(root)))

const turnEnd = (kind: string): unknown => ({ type: 'turn/end', seq: 12, time: 1_000, data: { turn: 3, reason: { kind } } })

describe('thread attention', () => {
  it('only turn ends that ask the user for something count as attention', () => {
    expect(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('completed'))).toBe('completed')
    expect(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('error'))).toBe('error')
    expect(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('aborted'))).toBe('aborted')
    expect(ThreadAttentionStoreModel.finishReasonFromEvent({ type: 'turn/end', data: { reason: { kind: 'aborted', reason: { kind: 'disposed' } } } })).toBe(
      null,
    )
    expect(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('blocked'))).toBe('blocked')
    expect(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('max-tokens'))).toBe('max-tokens')
    expect(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('forked'))).toBe(null)
    expect(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('interrupted'))).toBe(null)
    expect(ThreadAttentionStoreModel.finishReasonFromEvent({ type: 'turn/start', data: {} })).toBe(null)
    expect(ThreadAttentionStoreModel.finishReasonFromEvent('nonsense')).toBe(null)
  })

  it('a version always outranks every stored version, even after a clock step back', () => {
    expect(ThreadAttentionStoreModel.nextVersion(0, 1_000)).toBe(1_000)
    expect(ThreadAttentionStoreModel.nextVersion(1_000, 900)).toBe(1_001)
  })

  it.effect('a finished turn is stored durably and acknowledged once the caller saw it', () =>
    withAttention(5_000, root =>
      Effect.gen(function* () {
        const attention = yield* ThreadAttention
        yield* attention.recordFinish({ sessionId: 'thread', seq: 12, time: 4_000, reason: 'completed' })
        const recorded = yield* attention.snapshot
        expect(recorded.sessions).toEqual([
          { sessionId: 'thread', version: 5_001, finishedAt: 4_000, finishedSeq: 12, finishedReason: 'completed', manuallyUnread: false },
        ])

        expect((yield* attention.acknowledge({ sessionId: 'thread', version: 5_000 })).sessions).toHaveLength(1)
        expect((yield* attention.acknowledge({ sessionId: 'thread', version: 5_001 })).sessions).toEqual([])
        return root
      }),
    ).pipe(Effect.tap(root => Effect.map(durableRows(root), rows => expect(rows).toEqual([])))),
  )

  it.effect('a finish recorded after the browser read the row survives that acknowledgement', () =>
    withAttention(5_000, () =>
      Effect.gen(function* () {
        const attention = yield* ThreadAttention
        yield* attention.recordFinish({ sessionId: 'thread', seq: 12, time: 4_000, reason: 'completed' })
        const seen = (yield* attention.snapshot).sessions[0]
        yield* TestClock.setTime(6_000)
        yield* attention.recordFinish({ sessionId: 'thread', seq: 20, time: 5_500, reason: 'completed' })
        const afterStaleAck = yield* attention.acknowledge({ sessionId: 'thread', version: seen?.version ?? 0 })
        expect(afterStaleAck.sessions.map(record => record.finishedSeq)).toEqual([20])
      }),
    ),
  )

  it.effect('marking a thread unread by hand keeps its finish, durably', () =>
    withAttention(7_000, root =>
      Effect.gen(function* () {
        const attention = yield* ThreadAttention
        yield* attention.recordFinish({ sessionId: 'thread', seq: 3, time: 1_000, reason: 'error' })
        const marked = yield* attention.markUnread({ sessionId: 'thread' })
        expect(marked.sessions[0]).toEqual({
          sessionId: 'thread',
          version: 7_002,
          finishedAt: 1_000,
          finishedSeq: 3,
          finishedReason: 'error',
          manuallyUnread: true,
        })
        const markedOnly = yield* attention.markUnread({ sessionId: 'hand-marked' })
        expect(markedOnly.sessions.map(record => record.sessionId).sort()).toEqual(['hand-marked', 'thread'])
        expect(markedOnly.sessions.find(record => record.sessionId === 'hand-marked')).toEqual({
          sessionId: 'hand-marked',
          version: 7_003,
          finishedAt: null,
          finishedSeq: null,
          finishedReason: null,
          manuallyUnread: true,
        })
        return root
      }),
    ).pipe(
      Effect.tap(root =>
        Effect.map(durableRows(root), rows => expect(rows.find((row: ThreadAttentionView) => row.sessionId === 'thread')?.manuallyUnread).toBe(true)),
      ),
    ),
  )

  it.effect('bulk read clears only records no newer than the caller saw, and bulk unread preserves finishes', () =>
    withAttention(10_000, () =>
      Effect.gen(function* () {
        const attention = yield* ThreadAttention
        yield* attention.recordFinish({ sessionId: 'stale', seq: 1, time: 1_000, reason: 'completed' })
        yield* attention.recordFinish({ sessionId: 'current', seq: 2, time: 2_000, reason: 'error' })
        const seen = (yield* attention.snapshot).sessions
        const staleVersion = seen.find(record => record.sessionId === 'stale')?.version ?? 0
        const currentVersion = seen.find(record => record.sessionId === 'current')?.version ?? 0
        yield* TestClock.setTime(11_000)
        yield* attention.recordFinish({ sessionId: 'stale', seq: 3, time: 3_000, reason: 'completed' })

        const read = yield* attention.clearUnreadMany([
          { sessionId: 'stale', version: staleVersion },
          { sessionId: 'current', version: currentVersion },
        ])
        expect(read.sessions.map(record => record.sessionId)).toEqual(['stale'])

        const marked = yield* attention.markUnreadMany(['stale', 'new'])
        expect(marked.sessions.find(record => record.sessionId === 'stale')).toEqual({
          sessionId: 'stale',
          version: 11_001,
          finishedAt: 3_000,
          finishedSeq: 3,
          finishedReason: 'completed',
          manuallyUnread: true,
        })
        expect(marked.sessions.find(record => record.sessionId === 'new')?.manuallyUnread).toBe(true)
      }),
    ),
  )

  it.effect('acknowledging keeps a hand mark, and opening the thread drops the whole record', () =>
    withAttention(8_000, () =>
      Effect.gen(function* () {
        const attention = yield* ThreadAttention
        yield* attention.recordFinish({ sessionId: 'thread', seq: 3, time: 1_000, reason: 'completed' })
        const markedVersion = (yield* attention.markUnread({ sessionId: 'thread' })).sessions[0]?.version ?? 0
        const acknowledged = yield* attention.acknowledge({ sessionId: 'thread', version: markedVersion })
        expect(acknowledged.sessions).toEqual([
          { sessionId: 'thread', version: 8_003, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true },
        ])
        expect((yield* attention.clearUnread({ sessionId: 'thread', version: 8_003 })).sessions).toEqual([])
      }),
    ),
  )

  it.effect('adopting browser state never replaces a record the Host already holds', () =>
    withAttention(9_000, () =>
      Effect.gen(function* () {
        const attention = yield* ThreadAttention
        yield* attention.recordFinish({ sessionId: 'known', seq: 4, time: 2_000, reason: 'completed' })
        const migrated = yield* attention.migrate([
          { sessionId: 'known', finishedAt: 1_000, manuallyUnread: true },
          { sessionId: 'browser-only', finishedAt: 500, manuallyUnread: false },
          { sessionId: 'nothing-to-say', finishedAt: null, manuallyUnread: false },
        ])
        const byId = new Map(migrated.sessions.map(record => [record.sessionId, record]))
        expect(byId.get('known')).toEqual({
          sessionId: 'known',
          version: 9_001,
          finishedAt: 2_000,
          finishedSeq: 4,
          finishedReason: 'completed',
          manuallyUnread: false,
        })
        expect(byId.get('browser-only')?.finishedAt).toBe(500)
        expect(byId.has('nothing-to-say')).toBe(false)
      }),
    ),
  )

  it('the least recently written records are trimmed past the bound', () => {
    const record = (sessionId: string, version: number): ThreadAttentionView => ({
      sessionId,
      version,
      finishedAt: version,
      finishedSeq: null,
      finishedReason: null,
      manuallyUnread: false,
    })
    expect(ThreadAttentionStoreModel.keysToTrim([record('newest', 3), record('oldest', 1), record('middle', 2)], 2)).toEqual(['oldest'])
    expect(ThreadAttentionStoreModel.keysToTrim([record('a', 1)], 2)).toEqual([])
  })
})
