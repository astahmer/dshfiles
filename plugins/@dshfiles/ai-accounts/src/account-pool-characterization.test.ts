import { describe, expect, it } from 'vitest'
import { createAccountPool, type Distribution } from './account-pool.js'

/**
 * Pins the pool's distribution rules before `Random` and `Clock` replace `Math.random` and `Date.now`. Balanced
 * picks have no randomness seam today, so they are pinned as distribution properties over many draws. `noteServed`
 * and `describe` read the wall clock, so request times are placed relative to it: `T0` lies in the future and
 * `PAST` before any serve, which makes an account served "now" weigh exactly zero idle seconds.
 */
const T0 = Date.now() + 365 * 24 * 3_600_000
const PAST = 0
const accounts = (ids: readonly string[], kind = 'codex') => ids.map(id => ({ id, kind, label: id }))

const poolOf = (distribution: Distribution, ids: readonly string[], cooldownMs = 60_000) => {
  const pool = createAccountPool({ distribution, cooldownMs })
  for (const account of accounts(ids)) pool.put(account)
  return pool
}

describe('sticky affinity', () => {
  it('keeps a conversation on the account it first took while that account stays eligible', () => {
    const pool = poolOf('sticky', ['a', 'b', 'c'])
    const first = pool.acquire({ conversationKey: 'one', now: T0 })?.id
    const second = pool.acquire({ conversationKey: 'two', now: T0 })?.id

    expect([first, second]).toEqual(['a', 'b'])
    expect(pool.acquire({ conversationKey: 'one', now: T0 })?.id).toBe('a')
    expect(pool.acquire({ conversationKey: 'two', now: T0 })?.id).toBe('b')
  })

  it('rebinds a conversation whose account cooled and never moves it back on its own', () => {
    const pool = poolOf('sticky', ['a', 'b'])
    expect(pool.acquire({ conversationKey: 'one', now: T0 })?.id).toBe('a')
    pool.noteRateLimited('a', undefined, T0)

    expect(pool.acquire({ conversationKey: 'one', now: T0 + 1 })?.id).toBe('b')
    expect(pool.acquire({ conversationKey: 'one', now: T0 + 120_000 })?.id).toBe('b')
  })

  it('forgets the least recently used of 513 conversations, and a touch refreshes recency', () => {
    const pool = poolOf('sticky', ['a', 'b'])
    expect(pool.acquire({ conversationKey: 'oldest', now: T0 })?.id).toBe('a')
    expect(pool.acquire({ conversationKey: 'touched', now: T0 })?.id).toBe('b')
    for (let index = 0; index < 510; index++) pool.acquire({ conversationKey: `filler-${String(index)}`, now: T0 })
    expect(pool.acquire({ conversationKey: 'touched', now: T0 })?.id).toBe('b')
    pool.acquire({ conversationKey: 'newest', now: T0 })

    const cursorBefore = pool.acquire({ conversationKey: 'probe', now: T0 })?.id
    const oldest = pool.acquire({ conversationKey: 'oldest', now: T0 })?.id
    expect(oldest).toBe(cursorBefore === 'a' ? 'b' : 'a')
    expect(pool.acquire({ conversationKey: 'touched', now: T0 })?.id).toBe('b')
  })

  it('does not bind a conversation without a key', () => {
    const pool = poolOf('sticky', ['a', 'b'])

    expect([pool.acquire({ now: T0 })?.id, pool.acquire({ now: T0 })?.id, pool.acquire({ conversationKey: '', now: T0 })?.id]).toEqual(['a', 'b', 'a'])
  })
})

describe('round-robin cursor', () => {
  it('advances one cursor per scope key, independent of conversation', () => {
    const pool = poolOf('round-robin', ['a', 'b', 'c'])
    const codex = (conversationKey: string) => pool.acquire({ conversationKey, scopeKey: 'codex', now: T0 })?.id
    const keyed = () => pool.acquire({ scopeKey: 'keyed', candidateIds: ['b', 'c'], now: T0 })?.id

    expect([codex('one'), codex('one'), keyed(), codex('two'), keyed(), codex('one'), keyed()]).toEqual(['a', 'b', 'b', 'c', 'c', 'a', 'b'])
  })

  it('indexes the cursor into whatever is eligible now, so a cooling account shifts the rotation', () => {
    const pool = poolOf('round-robin', ['a', 'b', 'c'])
    expect(pool.acquire({ now: T0 })?.id).toBe('a')
    pool.noteRateLimited('b', 10_000, T0)

    expect([pool.acquire({ now: T0 })?.id, pool.acquire({ now: T0 })?.id, pool.acquire({ now: T0 })?.id]).toEqual(['c', 'a', 'c'])
    expect([pool.acquire({ now: T0 + 10_000 })?.id, pool.acquire({ now: T0 + 10_000 })?.id]).toEqual(['a', 'b'])
  })

  it('answers undefined when every candidate is cooling', () => {
    const pool = poolOf('round-robin', ['a'])
    pool.noteRateLimited('a', undefined, T0)

    expect(pool.acquire({ now: T0 })).toBeUndefined()
    expect(pool.acquire({ now: T0 + 60_000 })?.id).toBe('a')
  })
})

describe('priority', () => {
  it('drains the first eligible account in insertion order', () => {
    const pool = poolOf('priority', ['a', 'b'])
    expect([pool.acquire({ now: T0 })?.id, pool.acquire({ now: T0 })?.id]).toEqual(['a', 'a'])
    pool.noteRateLimited('a', undefined, T0)

    expect(pool.acquire({ now: T0 })?.id).toBe('b')
  })
})

describe('balanced weights', () => {
  const draws = (pool: ReturnType<typeof createAccountPool>, now: number, count: number) => {
    const picks = new Map<string, number>()
    for (let index = 0; index < count; index++) {
      const id = pool.acquire({ now })?.id ?? 'none'
      picks.set(id, (picks.get(id) ?? 0) + 1)
    }
    return picks
  }

  it('never picks an account with no idle time while a never-served one is eligible', () => {
    const pool = poolOf('balanced', ['served', 'fresh'])
    pool.noteServed('served')

    expect(draws(pool, PAST, 500)).toEqual(new Map([['fresh', 500]]))
  })

  it('falls back to the first eligible account when every weight is zero', () => {
    const pool = poolOf('balanced', ['a', 'b'])
    pool.noteServed('a')
    pool.noteServed('b')

    expect(draws(pool, PAST, 50)).toEqual(new Map([['a', 50]]))
  })

  it('weighs a never-served account as four idle seconds', () => {
    const pool = poolOf('balanced', ['idle', 'fresh'])
    pool.noteServed('idle')
    const picks = draws(pool, Date.now() + 12_000, 4_000)
    const idleShare = (picks.get('idle') ?? 0) / 4_000

    expect(idleShare).toBeGreaterThan(0.7)
    expect(idleShare).toBeLessThan(0.8)
  })

  it('does not bind affinity, so one conversation spreads across accounts', () => {
    const pool = poolOf('balanced', ['a', 'b'])
    const picked = new Set<string>()
    for (let index = 0; index < 200; index++) picked.add(pool.acquire({ conversationKey: 'one', now: T0 })?.id ?? 'none')

    expect(picked).toEqual(new Set(['a', 'b']))
  })
})

describe('replace', () => {
  it('keeps cooldown and recency of surviving accounts and adds new ones healthy', () => {
    const pool = poolOf('sticky', ['a', 'b'])
    const servedAfter = Date.now()
    pool.noteServed('a')
    pool.noteRateLimited('a', 30_000, T0)
    pool.replace([...accounts(['a']).map(account => ({ ...account, label: 'Renamed' })), ...accounts(['c'], 'opencode-go')])

    expect(pool.describe()).toEqual([
      {
        id: 'a',
        kind: 'codex',
        label: 'Renamed',
        enabled: true,
        state: 'cooling',
        cooldownUntil: T0 + 30_000,
        cooldownMs: 30_000,
        lastUsedAt: expect.any(Number),
      },
      { id: 'c', kind: 'opencode-go', label: 'c', enabled: true, state: 'healthy', cooldownUntil: undefined, cooldownMs: undefined, lastUsedAt: undefined },
    ])
    expect(pool.describe()[0]?.lastUsedAt).toBeGreaterThanOrEqual(servedAfter)
  })

  it('drops affinity and fail-over bindings that touch a disabled or removed account', () => {
    const pool = poolOf('sticky', ['a', 'b', 'c'])
    expect(pool.acquire({ conversationKey: 'one', now: T0 })?.id).toBe('a')
    pool.bindRoute('bound', 'a', 'b')
    pool.noteRateLimited('a', undefined, T0)
    expect(pool.routeFor('bound', 'a', T0)).toBe('b')

    pool.replace([...accounts(['a', 'c']), { id: 'b', kind: 'codex', label: 'b', enabled: false }])

    expect(pool.routeFor('bound', 'a', T0)).toBe('a')
    pool.clearCooldowns()
    expect(pool.acquire({ conversationKey: 'one', now: T0 })?.id).toBe('a')
  })
})

describe('route bindings', () => {
  it('holds a fail-over until the failed account recovers, then releases it for good', () => {
    const pool = poolOf('sticky', ['a', 'b'])
    pool.bindRoute('one', 'a', 'b')
    pool.noteRateLimited('a', 5_000, T0)

    expect(pool.routeFor('one', 'a', T0)).toBe('b')
    expect(pool.routeFor('one', 'other', T0)).toBe('other')
    expect(pool.routeFor(undefined, 'a', T0)).toBe('a')
    expect(pool.routeFor('one', 'a', T0 + 5_000)).toBe('a')
    pool.noteRateLimited('a', 5_000, T0 + 5_000)
    expect(pool.routeFor('one', 'a', T0 + 5_001)).toBe('a')
  })

  it('treats a binding to the same account as an unbind', () => {
    const pool = poolOf('sticky', ['a', 'b'])
    pool.bindRoute('one', 'a', 'b')
    pool.noteRateLimited('a', undefined, T0)
    pool.bindRoute('one', 'a', 'a')

    expect(pool.routeFor('one', 'a', T0)).toBe('a')
  })

  it('tracks the failed account separately from the route it stands in for', () => {
    const pool = poolOf('sticky', ['a', 'b', 'c'])
    pool.bindRoute('one', 'a', 'c', 'b')
    pool.noteRateLimited('b', undefined, T0)

    expect(pool.routeFor('one', 'a', T0)).toBe('c')
    pool.clearCooldowns()
    expect(pool.routeFor('one', 'a', T0)).toBe('a')
  })
})

describe('cooldowns', () => {
  it('honours a positive retry-after exactly and falls back to the configured cooldown otherwise', () => {
    const pool = poolOf('sticky', ['a', 'b', 'c'], 90_000)
    pool.noteRateLimited('a', 1_500, T0)
    pool.noteRateLimited('b', 0, T0)
    pool.noteRateLimited('c', Number.NaN, T0)

    expect(pool.describe().map(account => account.cooldownMs)).toEqual([1_500, 90_000, 90_000])
  })

  it('floors a declared reset at the configured cooldown and caps it at a day', () => {
    const pool = poolOf('sticky', ['short', 'long', 'invalid', 'exact'], 90_000)
    pool.noteDeclaredReset('short', 1_000, T0)
    pool.noteDeclaredReset('long', 30 * 3_600_000, T0)
    pool.noteDeclaredReset('invalid', -5, T0)
    pool.noteDeclaredReset('exact', 2 * 3_600_000, T0)

    expect(pool.describe().map(account => [account.id, account.cooldownMs, account.cooldownUntil])).toEqual([
      ['short', 90_000, T0 + 90_000],
      ['long', 24 * 3_600_000, T0 + 24 * 3_600_000],
      ['invalid', 90_000, T0 + 90_000],
      ['exact', 2 * 3_600_000, T0 + 2 * 3_600_000],
    ])
  })

  it('ignores an unknown distribution and keeps the current one', () => {
    const pool = createAccountPool({ distribution: 'priority' })
    // SAFETY: an older stored file can carry a retired distribution name; the pool must ignore it.
    pool.setDistribution('weighted' as Distribution)

    expect(pool.distribution()).toBe('priority')
    // SAFETY: same stored-file case for the constructor option.
    expect(createAccountPool({ distribution: 'weighted' as Distribution }).distribution()).toBe('sticky')
  })
})
