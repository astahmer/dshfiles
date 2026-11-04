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
})
