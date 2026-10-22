import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { jevUsageQuerySchema, jevUsageRecordSchema, type JevUsageRecord } from './jev-usage.js'
import { openUsageStore, type UsageStore } from './store.js'

const stores: UsageStore[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.close()
})

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
  it('aggregates only the requested range and estimates input cost', () => {
    const store = openUsageStore(':memory:')
    stores.push(store)
    store.recordJevUsage(record())
    store.recordJevUsage(
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
    store.recordJevUsage(record({ requestId: randomUUID(), startedAt: 100 }))

    expect(store.jevUsage({ from: 0, to: 100 })).toEqual({
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
  })

  it('splits one credential across sources and preserves source counts', () => {
    const store = openUsageStore(':memory:')
    stores.push(store)
    store.recordJevUsage(record({ credential: 'secret:SHARED_JEV', source: 'memory', startedAt: 20, inputTokens: 25 }))
    store.recordJevUsage(record({ credential: 'secret:SHARED_JEV', source: 'backlog', startedAt: 30, inputTokens: 75 }))

    expect(store.jevUsage({ from: 0, to: 100 }).byCredential).toMatchObject([
      { credential: 'secret:SHARED_JEV', calls: 2, backlogCalls: 1, memoryCalls: 1, inputTokens: 100 },
    ])
  })

  it('keeps totals exact when more than twenty credentials are present', () => {
    const store = openUsageStore(':memory:')
    stores.push(store)
    for (let index = 0; index < 25; index++)
      store.recordJevUsage(record({ credential: `secret:JEV_${String(index).padStart(2, '0')}`, startedAt: 10 + index, inputTokens: 100 }))

    const usage = store.jevUsage({ from: 0, to: 100 })
    expect(usage.byCredential).toHaveLength(20)
    const otherCredentials = usage.byCredential.at(-1)
    expect(otherCredentials).toMatchObject({ credential: 'Other credentials', calls: 6, succeeded: 6, inputTokens: 600 })
    expect(otherCredentials?.estimatedCostUsd).toBeCloseTo(0.0000252)
    expect(usage.calls).toBe(25)
    expect(usage.inputTokens).toBe(2_500)
    expect(usage.estimatedCostUsd).toBe(0.000105)
  })

  it('preserves missing token fields when the provider reports none', () => {
    const store = openUsageStore(':memory:')
    stores.push(store)
    store.recordJevUsage(record({ inputTokens: null, outputTokens: null }))

    expect(store.jevUsage({ from: 0, to: 100 })).toMatchObject({
      calls: 1,
      succeeded: 1,
      callsWithoutInputUsage: 1,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
    })
  })

  it('deduplicates the same request id and rejects credentials or request text at the boundary', () => {
    const store = openUsageStore(':memory:')
    stores.push(store)
    const jevRecord = record({ inputTokens: 10, outputTokens: 2 })
    store.recordJevUsage(jevRecord)
    store.recordJevUsage(jevRecord)

    expect(store.jevUsage({ from: 0, to: 100 }).calls).toBe(1)
    expect(jevUsageRecordSchema.safeParse({ ...jevRecord, apiKey: 'synthetic-test-key' }).success).toBe(false)
    expect(jevUsageRecordSchema.safeParse({ ...jevRecord, prompt: 'synthetic request text' }).success).toBe(false)
    expect(jevUsageRecordSchema.safeParse({ ...jevRecord, credential: 'synthetic-secret-value' }).success).toBe(false)
    expect(jevUsageQuerySchema.safeParse({ from: 100, to: 0 }).success).toBe(false)
  })
})
