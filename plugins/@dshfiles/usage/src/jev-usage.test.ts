import { randomUUID } from 'node:crypto'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { jevUsageQuerySchema, jevUsageRecordSchema, type JevUsageRecord } from './jev-usage.js'
import { UsageRepo } from './store.js'
import { usageRepoTest } from './test-layers.js'
import * as Schema from 'effect/Schema'

// oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown test input
const strictAccepts = <ValueSchema extends Schema.ConstraintDecoder<unknown>>(schema: ValueSchema, value: unknown): boolean =>
  Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)._tag === 'Success'

const record = (overrides: Partial<JevUsageRecord> = {}): JevUsageRecord => ({
  requestId: randomUUID(),
  source: 'memory',
  credential: 'secret:JEV_KEY',
  startedAt: 10,
  durationMs: 25,
  outcome: 'success',
  inputTokens: 1_000_000,
  outputTokens: 42,
  ...overrides,
})

describe('Jev usage storage', () => {
  it.effect('aggregates only the requested range and estimates input cost', () =>
    Effect.gen(function* () {
      const store = yield* UsageRepo
      yield* store.recordJevUsage(record())
      yield* store.recordJevUsage(
        record({
          requestId: randomUUID(),
          source: 'backlog',
          credential: 'env:TYPESAFE_API_KEY',
          startedAt: 50,
          outcome: 'failure',
          inputTokens: null,
          outputTokens: null,
        }),
      )
      yield* store.recordJevUsage(record({ requestId: randomUUID(), startedAt: 100 }))

      expect(yield* store.jevUsage({ from: 0, to: 100 })).toEqual({
        calls: 2,
        succeeded: 1,
        failed: 1,
        inputTokens: 1_000_000,
        outputTokens: 42,
        callsWithoutInputUsage: 1,
        estimatedCostUsd: 0.042,
        byCredential: [
          {
            credential: 'env:TYPESAFE_API_KEY',
            backlogCalls: 1,
            memoryCalls: 0,
            calls: 1,
            succeeded: 0,
            failed: 1,
            inputTokens: 0,
            outputTokens: 0,
            callsWithoutInputUsage: 1,
            estimatedCostUsd: 0,
          },
          {
            credential: 'secret:JEV_KEY',
            backlogCalls: 0,
            memoryCalls: 1,
            calls: 1,
            succeeded: 1,
            failed: 0,
            inputTokens: 1_000_000,
            outputTokens: 42,
            callsWithoutInputUsage: 0,
            estimatedCostUsd: 0.042,
          },
        ],
      })
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('splits one credential across sources and preserves source counts', () =>
    Effect.gen(function* () {
      const store = yield* UsageRepo
      yield* store.recordJevUsage(record({ credential: 'secret:SHARED_JEV', source: 'memory', startedAt: 20, inputTokens: 25 }))
      yield* store.recordJevUsage(record({ credential: 'secret:SHARED_JEV', source: 'backlog', startedAt: 30, inputTokens: 75 }))

      expect((yield* store.jevUsage({ from: 0, to: 100 })).byCredential).toMatchObject([
        { credential: 'secret:SHARED_JEV', calls: 2, backlogCalls: 1, memoryCalls: 1, inputTokens: 100 },
      ])
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('keeps totals exact when more than twenty credentials are present', () =>
    Effect.gen(function* () {
      const store = yield* UsageRepo
      for (let index = 0; index < 25; index++)
        yield* store.recordJevUsage(record({ credential: `secret:JEV_${String(index).padStart(2, '0')}`, startedAt: 10 + index, inputTokens: 100 }))

      const usage = yield* store.jevUsage({ from: 0, to: 100 })
      expect(usage.byCredential).toHaveLength(20)
      const otherCredentials = usage.byCredential.at(-1)
      expect(otherCredentials).toMatchObject({ credential: 'Other credentials', calls: 6, succeeded: 6, inputTokens: 600 })
      expect(otherCredentials?.estimatedCostUsd).toBeCloseTo(0.0000252)
      expect(usage.calls).toBe(25)
      expect(usage.inputTokens).toBe(2_500)
      expect(usage.estimatedCostUsd).toBe(0.000105)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('preserves missing token fields when the provider reports none', () =>
    Effect.gen(function* () {
      const store = yield* UsageRepo
      yield* store.recordJevUsage(record({ inputTokens: null, outputTokens: null }))

      expect(yield* store.jevUsage({ from: 0, to: 100 })).toMatchObject({
        calls: 1,
        succeeded: 1,
        callsWithoutInputUsage: 1,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCostUsd: 0,
      })
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('deduplicates the same request id and rejects credentials or request text at the boundary', () =>
    Effect.gen(function* () {
      const store = yield* UsageRepo
      const jevRecord = record({ inputTokens: 10, outputTokens: 2 })
      yield* store.recordJevUsage(jevRecord)
      yield* store.recordJevUsage(jevRecord)

      expect((yield* store.jevUsage({ from: 0, to: 100 })).calls).toBe(1)
      expect(strictAccepts(jevUsageRecordSchema, { ...jevRecord, apiKey: 'synthetic-test-key' })).toBe(false)
      expect(strictAccepts(jevUsageRecordSchema, { ...jevRecord, prompt: 'synthetic request text' })).toBe(false)
      expect(strictAccepts(jevUsageRecordSchema, { ...jevRecord, credential: 'synthetic-secret-value' })).toBe(false)
      expect(strictAccepts(jevUsageQuerySchema, { from: 100, to: 0 })).toBe(false)
    }).pipe(Effect.provide(usageRepoTest())),
  )
})
