import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { RECOVERY_FILE, RecoveryStore, activeRestartSessionIds } from './restart-recovery.js'
import { StateFiles } from './runtime-files.js'
import { temporaryStateFiles } from './state-files.test-support.js'

const recoveryLayer = RecoveryStore.layer.pipe(Layer.provideMerge(temporaryStateFiles))

/** A second store over the same files, as the next Host process opens them. */
const reopened = <A, E>(effect: Effect.Effect<A, E, RecoveryStore>) =>
  Effect.gen(function* () {
    const files = yield* StateFiles
    return yield* effect.pipe(Effect.provide(RecoveryStore.layer.pipe(Layer.provide(Layer.succeed(StateFiles, files)))))
  })

describe('restart recovery', () => {
  it('restart capture includes only Agents still running at the exit boundary', () => {
    expect(
      activeRestartSessionIds([
        { id: 'working', status: 'running' },
        { id: 'finished', status: 'idle' },
        { id: 'user-cancelled', status: 'idle' },
        { id: 'working', status: 'running' },
      ]),
    ).toEqual(['working'])
  })

  it.effect('restart recovery entries survive Host replacement and dedupe later restart captures', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(101)
      const store = yield* RecoveryStore
      yield* store.record({ sessionIds: ['active', 'active'], reason: 'restart' })
      yield* store.record({ sessionIds: ['active', 'another-active'], reason: 'restart' })
      const first = (yield* store.list)[0]

      const entries = yield* reopened(RecoveryStore.use(next => next.list))
      expect(entries.map(entry => entry.sessionId)).toEqual(['active', 'another-active'])
      expect(entries[0]).toEqual(first)
      expect(entries[0]?.interruptedAt).toBe(101)
      expect(entries[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/u)

      yield* store.remove(new Set(['active']))
      expect((yield* reopened(RecoveryStore.use(next => next.list))).map(entry => entry.sessionId)).toEqual(['another-active'])
    }).pipe(Effect.provide(recoveryLayer)),
  )

  it.effect('concurrent restart snapshots keep every unique recovery candidate', () =>
    Effect.gen(function* () {
      const store = yield* RecoveryStore
      yield* Effect.all(
        [store.record({ sessionIds: ['first', 'shared'], reason: 'restart' }), store.record({ sessionIds: ['second', 'shared'], reason: 'restart' })],
        { concurrency: 'unbounded' },
      )
      expect((yield* store.list).map(entry => entry.sessionId).sort()).toEqual(['first', 'second', 'shared'])
    }).pipe(Effect.provide(recoveryLayer)),
  )

  it.effect('dismiss removes one recovery candidate without changing other entries', () =>
    Effect.gen(function* () {
      const store = yield* RecoveryStore
      const files = yield* StateFiles
      const fs = yield* FileSystem.FileSystem
      yield* store.record({ sessionIds: ['finished-later', 'still-needs-resume'], reason: 'restart' })
      yield* store.remove(new Set(['finished-later']))
      const text = yield* fs.readFileString(files.runtimePath(RECOVERY_FILE))
      expect(text).toMatch(/still-needs-resume/u)
      expect(text).not.toMatch(/finished-later/u)
    }).pipe(Effect.provide(recoveryLayer)),
  )

  it.effect('a recovery file written before reasons existed reads as managed restarts', () =>
    Effect.gen(function* () {
      const files = yield* StateFiles
      yield* files.write({
        path: files.runtimePath(RECOVERY_FILE),
        text: `${JSON.stringify({ version: 1, entries: [{ sessionId: 'older-entry', requestId: '00000000-0000-4000-8000-000000000001', interruptedAt: 7 }] })}\n`,
      })
      const entries = yield* RecoveryStore.use(store => store.list)
      expect(entries.map(entry => [entry.sessionId, entry.reason])).toEqual([['older-entry', 'restart']])
    }).pipe(Effect.provide(recoveryLayer)),
  )

  it.effect('an unreadable recovery file fails as invalid state instead of reading as empty', () =>
    Effect.gen(function* () {
      const files = yield* StateFiles
      yield* files.write({ path: files.runtimePath(RECOVERY_FILE), text: '{"version":9}' })
      const error = yield* Effect.flip(RecoveryStore.use(store => store.list))
      expect(error._tag).toBe('RuntimeStateInvalid')
    }).pipe(Effect.provide(recoveryLayer)),
  )
})
