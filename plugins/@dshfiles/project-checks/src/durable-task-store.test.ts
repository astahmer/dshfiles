import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Fiber, Layer, Option } from 'effect'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { DurableTaskStore } from './durable-task-store.ts'
import { DurableTestLayers } from './test-fixtures/durable-layers.ts'

const temporaryRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'dsh-project-checks-store-'))),
  root => Effect.promise(() => rm(root, { recursive: true, force: true })),
)

describe('DurableTaskStore', () => {
  it.live('retries a read while another Host holds the database lock', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      const store = Context.get(yield* Layer.build(DurableTestLayers.store(root)), DurableTaskStore)
      const otherHost = yield* Effect.acquireRelease(
        Effect.sync(() => new DatabaseSync(join(root, 'durable-tasks.sqlite'), { timeout: 0 })),
        database => Effect.sync(() => database.close()),
      )
      otherHost.exec('BEGIN EXCLUSIVE')
      const read = yield* Effect.forkChild(store.get('a'.repeat(64)))
      yield* Effect.sleep('150 millis')
      otherHost.exec('COMMIT')
      expect(Option.isNone(yield* Fiber.join(read))).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.live('lists only the newest tasks of one session, up to the limit', () =>
    Effect.gen(function* () {
      const root = yield* temporaryRoot
      const session = (index: number, sessionId: string, createdAt: number) =>
        DurableTestLayers.queuedTask({
          id: index.toString(16).padStart(64, '0'),
          idempotencyKey: `00000000-0000-4000-8000-00000000000${index}`,
          sessionId,
          createdAt,
        })
      yield* Effect.gen(function* () {
        const store = yield* DurableTaskStore
        yield* Effect.forEach(
          [session(1, 'session-a', 10), session(2, 'session-b', 20), session(3, 'session-a', 30), session(4, 'session-a', 40)],
          task => store.createIfAbsent({ task }),
          { discard: true },
        )
        const listed = yield* store.listForSession({ sessionId: 'session-a', limit: 2 })
        expect(listed.map(task => task.createdAt)).toEqual([40, 30])
        expect(listed.every(task => task.sessionId === 'session-a')).toBe(true)
      }).pipe(Effect.provide(DurableTestLayers.store(root)), Effect.scoped)
    }).pipe(Effect.scoped),
  )
})
