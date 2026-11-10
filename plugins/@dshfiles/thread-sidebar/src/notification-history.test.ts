import { NodeFileSystem } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer } from 'effect'
import { NotificationHistory } from './notification-history.js'
import { jsonStorageDomain } from './storage.test-support.js'

const historyAt = (root: string) => NotificationHistory.layer.pipe(Layer.provide(jsonStorageDomain(root)))
const withRoot = <A, E, R>(body: (root: string) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'notification-history-' })
    return yield* body(root)
  }).pipe(Effect.provide(NodeFileSystem.layer))
const entry = (index: number) => ({ id: `finish-${index}`, sessionId: 'thread', at: index, category: 'turn-finished' as const })

const withHistory = <A, E>(body: (history: NotificationHistory['Service']) => Effect.Effect<A, E>) =>
  withRoot(root => NotificationHistory.use(body).pipe(Effect.provide(historyAt(root))))

describe('persistent notification history', () => {
  it.effect('retains independent occurrences and user flags after closing and reopening storage', () =>
    withRoot(root =>
      Effect.gen(function* () {
        yield* NotificationHistory.use(history =>
          Effect.gen(function* () {
            yield* history.record(entry(1))
            yield* history.record(entry(2))
            yield* history.setRead({ ids: ['finish-1'], read: true })
            yield* history.setDismissed({ id: 'finish-2', dismissed: true })
          }),
        ).pipe(Effect.provide(historyAt(root)))
        const reopened = yield* NotificationHistory.use(history => history.snapshot).pipe(Effect.provide(historyAt(root)))
        expect(reopened.entries).toEqual([
          { ...entry(2), read: false, dismissed: true },
          { ...entry(1), read: true, dismissed: false },
        ])
      }),
    ),
  )

  it.effect('never resurrects cleared entries after reopening storage', () =>
    withRoot(root =>
      Effect.gen(function* () {
        yield* NotificationHistory.use(history =>
          Effect.gen(function* () {
            yield* history.record(entry(1))
            yield* history.clear({ ids: ['finish-1'], confirm: true })
          }),
        ).pipe(Effect.provide(historyAt(root)))
        expect(yield* NotificationHistory.use(history => history.snapshot).pipe(Effect.provide(historyAt(root)))).toEqual({ entries: [] })
      }),
    ),
  )

  it.effect(
    'retains only 500 newest occurrences including dismissed entries with deterministic ties',
    () =>
      withHistory(history =>
        Effect.gen(function* () {
          yield* Effect.forEach(
            Array.from({ length: 501 }, (_, index) => index),
            index => history.record(entry(index)),
            { discard: true },
          )
          const retained = yield* history.snapshot
          expect(retained.entries).toHaveLength(500)
          expect(retained.entries[0]?.id).toBe('finish-500')
          expect(retained.entries.at(-1)?.id).toBe('finish-1')
          yield* history.setDismissed({ id: 'finish-1', dismissed: true })
          yield* history.record({ ...entry(502), at: 500, id: 'a-tie' })
          const next = yield* history.snapshot
          expect(next.entries).toHaveLength(500)
          expect(next.entries.slice(0, 2).map(item => item.id)).toEqual(['a-tie', 'finish-500'])
          expect(next.entries.some(item => item.id === 'finish-1')).toBe(false)
        }),
      ),
    { timeout: 30_000 },
  )

  it.effect('deduplicates a retained event without resetting its category or user choices', () =>
    withHistory(history =>
      Effect.gen(function* () {
        yield* history.record(entry(1))
        yield* history.setRead({ ids: ['finish-1'], read: true })
        yield* history.setDismissed({ id: 'finish-1', dismissed: true })
        yield* history.record({ ...entry(1), at: 9, category: 'failed' })
        expect((yield* history.snapshot).entries).toEqual([{ ...entry(1), read: true, dismissed: true }])
      }),
    ),
  )

  it.effect('read and dismiss operations do not lose one another when run concurrently', () =>
    withHistory(history =>
      Effect.gen(function* () {
        yield* history.record(entry(1))
        yield* Effect.all([history.setRead({ ids: ['finish-1'], read: true }), history.setDismissed({ id: 'finish-1', dismissed: true })], {
          concurrency: 'unbounded',
        })
        expect((yield* history.snapshot).entries).toEqual([{ ...entry(1), read: true, dismissed: true }])
        yield* history.setDismissed({ id: 'finish-1', dismissed: false })
        expect((yield* history.snapshot).entries).toEqual([{ ...entry(1), read: true, dismissed: false }])
        yield* history.setRead({ ids: ['finish-1'], read: false })
        expect((yield* history.snapshot).entries).toEqual([{ ...entry(1), read: false, dismissed: false }])
      }),
    ),
  )

  it.effect('clears only the captured ids while a new occurrence arrives concurrently', () =>
    withHistory(history =>
      Effect.gen(function* () {
        yield* history.record(entry(1))
        const ids = (yield* history.snapshot).entries.map(item => item.id)
        yield* Effect.all([history.clear({ ids, confirm: true }), history.record(entry(2))], { concurrency: 'unbounded' })
        expect((yield* history.snapshot).entries).toEqual([{ ...entry(2), read: false, dismissed: false }])
        yield* history.clear({ ids, confirm: true })
        expect((yield* history.snapshot).entries).toHaveLength(1)
      }),
    ),
  )

  it.effect('unknown ids never create entries and repeated state changes are idempotent', () =>
    withHistory(history =>
      Effect.gen(function* () {
        expect(yield* history.setRead({ ids: ['missing'], read: true })).toEqual({ entries: [] })
        expect(yield* history.setDismissed({ id: 'missing', dismissed: true })).toEqual({ entries: [] })
        yield* history.record(entry(1))
        yield* history.setRead({ ids: ['finish-1', 'finish-1'], read: true })
        expect(yield* history.setRead({ ids: ['finish-1'], read: true })).toEqual({ entries: [{ ...entry(1), read: true, dismissed: false }] })
      }),
    ),
  )

  it.effect('rejects extra private fields and invalid ids before writing anything', () =>
    withHistory(history =>
      Effect.gen(function* () {
        const privateRecord = { ...entry(1), title: 'private thread title', prompt: 'private prompt' }
        const rejected = yield* Effect.result(history.record(privateRecord))
        expect(rejected._tag).toBe('Failure')
        expect((yield* Effect.result(history.record({ ...entry(2), id: '', at: -1 })))._tag).toBe('Failure')
        expect(yield* history.snapshot).toEqual({ entries: [] })
      }),
    ),
  )
})
