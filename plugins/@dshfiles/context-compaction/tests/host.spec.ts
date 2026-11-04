import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import plugin from '../src/host.js'

const mount = (config: { readonly maxTokens?: number } | undefined) =>
  Effect.gen(function* () {
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      testHost => Effect.promise(() => testHost.dispose()),
    )
    yield* Effect.promise(() => host.ctx.plugin(LlmRuntime))
    return yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/context-compaction', config }))
  })

describe('the context-compaction Host', () => {
  it.effect('activates with an empty row config and unloads cleanly', () =>
    Effect.gen(function* () {
      const mounted = yield* mount({})
      expect(mounted.fiber.state).toBe(2)
      yield* Effect.promise(() => mounted.dispose())
    }).pipe(Effect.scoped),
  )

  it.effect('refuses a row config whose maxTokens is not a positive integer', () =>
    Effect.gen(function* () {
      const refused = yield* mount({ maxTokens: 0 }).pipe(Effect.exit)
      expect(refused._tag).toBe('Failure')
    }).pipe(Effect.scoped),
  )
})
