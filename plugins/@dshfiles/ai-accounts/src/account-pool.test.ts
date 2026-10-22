import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { createAccountPool, creditServedAttempt } from './account-pool.js'

describe('account pool route reconciliation', () => {
  it('updates account metadata while preserving live cooldown and conversation affinity', () => {
    const pool = createAccountPool()
    pool.put({ id: 'opencode-one', kind: 'opencode-go', label: 'OpenCode One' })
    pool.put({ id: 'opencode-two', kind: 'opencode-go', label: 'OpenCode Two' })

    expect(pool.acquire({ conversationKey: 'conversation-one' })?.id).toBe('opencode-one')
    pool.noteRateLimited('opencode-one', 60_000)
    pool.replace([
      { id: 'opencode-one', kind: 'opencode-go', label: 'Renamed Account' },
      { id: 'opencode-two', kind: 'opencode-go', label: 'OpenCode Two' },
    ])

    expect(pool.describe()).toMatchObject([
      { id: 'opencode-one', label: 'Renamed Account', state: 'cooling' },
      { id: 'opencode-two', label: 'OpenCode Two', state: 'healthy' },
    ])
    expect(pool.acquire({ conversationKey: 'conversation-one' })?.id).toBe('opencode-two')
  })

  it('holds a distributed failover until the physical account recovers', () => {
    const pool = createAccountPool()
    pool.put({ id: 'codex-selected', kind: 'codex', label: 'Codex Selected' })
    pool.put({ id: 'codex-failed', kind: 'codex', label: 'Codex Failed' })
    pool.put({ id: 'codex-stand-in', kind: 'codex', label: 'Codex Stand-in' })
    pool.noteRateLimited('codex-failed', 60_000, 1_000)
    pool.bindRoute('conversation-one', 'codex-selected', 'codex-stand-in', 'codex-failed')

    expect(pool.routeFor('conversation-one', 'codex-selected', 1_001)).toBe('codex-stand-in')
    expect(pool.routeFor('conversation-one', 'codex-selected', 61_001)).toBe('codex-selected')
  })

  it('drops removed routes and disables accounts without resetting other health', () => {
    const pool = createAccountPool()
    pool.put({ id: 'opencode-one', kind: 'opencode-go', label: 'OpenCode One' })
    pool.put({ id: 'commandcode-one', kind: 'commandcode', label: 'Command Code One' })
    pool.noteRateLimited('commandcode-one', 60_000)

    pool.replace([
      { id: 'opencode-one', kind: 'opencode-go', label: 'OpenCode One', enabled: false },
      { id: 'commandcode-one', kind: 'commandcode', label: 'Command Code One' },
    ])
    expect(pool.describe()).toMatchObject([
      { id: 'opencode-one', enabled: false, state: 'disabled' },
      { id: 'commandcode-one', state: 'cooling' },
    ])
    expect(pool.acquire({ conversationKey: 'conversation-one' })?.id).toBeUndefined()

    pool.replace([{ id: 'commandcode-one', kind: 'commandcode', label: 'Command Code One' }])
    expect(pool.describe().map(account => account.id)).toEqual(['commandcode-one'])
    expect(pool.describe()[0]?.state).toBe('cooling')
  })
})

describe('declared reset cooldown', () => {
  const poolWith = (cooldownMs: number) => {
    const pool = createAccountPool({ cooldownMs })
    pool.put({ id: 'codex-a', kind: 'codex', label: 'Codex A' })
    return pool
  }

  it('cools until the reset the provider declared', () => {
    const pool = poolWith(60_000)
    const now = 1_000_000
    pool.noteDeclaredReset('codex-a', 151 * 60_000, now)

    expect(pool.isHealthy('codex-a', now + 150 * 60_000)).toBe(false)
    expect(pool.isHealthy('codex-a', now + 152 * 60_000)).toBe(true)
    expect(pool.describe()[0]?.cooldownMs).toBe(151 * 60_000)
  })

  it('floors a short hint at the configured cooldown', () => {
    const pool = poolWith(60_000)
    pool.noteDeclaredReset('codex-a', 5_000, 1_000)

    expect(pool.describe()[0]?.cooldownMs).toBe(60_000)
    expect(pool.isHealthy('codex-a', 60_000)).toBe(false)
    expect(pool.isHealthy('codex-a', 61_001)).toBe(true)
  })

  it('caps a distant reset at a day', () => {
    const pool = poolWith(60_000)
    pool.noteDeclaredReset('codex-a', 7 * 24 * 3_600_000, 1_000)

    expect(pool.describe()[0]?.cooldownMs).toBe(24 * 3_600_000)
  })
})

describe('creditServedAttempt', () => {
  const drain = async (chunks: readonly StreamChunk[], accountId: string | undefined) => {
    const served: string[] = []
    const seen: StreamChunk[] = []
    async function* source(): AsyncIterable<StreamChunk> {
      yield* chunks
    }
    for await (const chunk of creditServedAttempt(source(), { pool: { noteServed: id => served.push(id) }, accountId })) seen.push(chunk)
    return { served, seen }
  }

  it('forwards an error finish so the agent loop retries instead of completing a reasoning-only step', async () => {
    const timedOut: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT', message: 'pi-ai stream idle timeout after 120000ms' } } },
    ]
    const { served, seen } = await drain(timedOut, 'codex-a')
    expect(seen.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'TIMEOUT' } } })
    expect(served).toEqual([])
  })

  it('credits the account once a reported attempt finishes', async () => {
    const answered: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const { served, seen } = await drain(answered, 'codex-a')
    expect(seen).toHaveLength(2)
    expect(served).toEqual(['codex-a'])
  })
})
