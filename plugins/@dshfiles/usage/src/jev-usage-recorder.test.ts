import type { ApiCaller } from '@dshfiles/dshx/api'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import type { JevUsageRecord } from './jev-usage.js'
import { recordJevUsage } from './jev-usage-recorder.js'
import { UsageRepo } from './store.js'
import { usageRepoTest } from './test-layers.js'

const record: JevUsageRecord = {
  requestId: '00000000-0000-4000-8000-000000000001',
  source: 'backlog',
  credential: 'secret:JEV_KEY',
  startedAt: 100,
  durationMs: 50,
  outcome: 'success',
  inputTokens: 12,
  outputTokens: 4,
}

const recordedCalls = UsageRepo.use(repo => repo.jevUsage({ from: 0, to: 1_000 })).pipe(Effect.map(usage => usage.calls))

describe('Jev usage recorder authorization', () => {
  it.effect('rejects clients and agent callers before persisting', () =>
    Effect.gen(function* () {
      for (const caller of [{ kind: 'client' }, { kind: 'agent', sessionId: 'session-safe' }] satisfies ApiCaller[]) {
        const rejected = yield* Effect.flip(recordJevUsage({ record, caller }))
        expect(rejected).toMatchObject({ _tag: 'JevCallerRejected', source: 'backlog', message: 'Only the Jev source plugin may record its own usage.' })
      }
      expect(yield* recordedCalls).toBe(0)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('rejects a Jev plugin claiming another source and accepts only its matching source', () =>
    Effect.gen(function* () {
      const rejected = yield* Effect.flip(recordJevUsage({ record, caller: { kind: 'plugin', packageId: '@dshfiles/memory' } }))
      expect(rejected._tag).toBe('JevCallerRejected')
      expect(yield* recordedCalls).toBe(0)

      expect(yield* recordJevUsage({ record, caller: { kind: 'plugin', packageId: '@dshfiles/backlog' } })).toEqual({ accepted: true })
      expect(yield* recordedCalls).toBe(1)
    }).pipe(Effect.provide(usageRepoTest())),
  )
})
