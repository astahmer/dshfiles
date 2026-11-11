import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import plugin from '../src/host.js'

const mount = (
  config:
    | {
        readonly maxTokens?: number
        readonly idleCacheStrategy?: 'off' | 'compact'
        readonly idle?: { readonly enabled?: boolean; readonly minTokens?: number; readonly lifetimeMinutes?: number; readonly leadMinutes?: number }
      }
    | undefined,
) =>
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

  it.effect('refuses an idle token floor above the sessions API cap', () =>
    Effect.gen(function* () {
      const refused = yield* mount({ idleCacheStrategy: 'compact', idle: { minTokens: 10_000_001 } }).pipe(Effect.exit)
      expect(refused._tag).toBe('Failure')
    }).pipe(Effect.scoped),
  )

  it.effect('accepts the compact strategy and refuses the warm one it cannot bill', () =>
    Effect.gen(function* () {
      const compact = yield* mount({ idleCacheStrategy: 'compact' })
      expect(compact.fiber.state).toBe(2)
      yield* Effect.promise(() => compact.dispose())
      const warm = yield* mount({ idleCacheStrategy: 'warm' as 'off' }).pipe(Effect.exit)
      expect(warm._tag).toBe('Failure')
    }).pipe(Effect.scoped),
  )

  it.effect('treats a legacy idle.enabled row as the compact strategy', () =>
    Effect.gen(function* () {
      const legacy = yield* mount({ idle: { enabled: true } })
      expect(legacy.fiber.state).toBe(2)
      yield* Effect.promise(() => legacy.dispose())
    }).pipe(Effect.scoped),
  )
})
