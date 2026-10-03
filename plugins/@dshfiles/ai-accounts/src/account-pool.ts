/**
 * Account pool and distribution, after `dsh-workbuddy-xdpool`.
 *
 * Modes:
 * - `sticky` (default): one account per conversation. No rotation inside a
 *   conversation, because the upstream prompt cache is per-account and switching
 *   mid-conversation discards it.
 * - `priority`: drain one account until it is rate-limited, then the next.
 * - `round-robin`: every request advances the cursor.
 * - `balanced`: weighted random, biased toward the least recently served.
 *
 * 429 failover applies in every mode: a rate-limited account is skipped until
 * its window resets and the conversation rebinds. Distribution only picks which
 * healthy account serves the next request; it never decides whether to fail over.
 */

export const DISTRIBUTIONS = ['sticky', 'priority', 'round-robin', 'balanced'] as const
export type Distribution = (typeof DISTRIBUTIONS)[number]
export const DEFAULT_DISTRIBUTION: Distribution = 'sticky'

const STICKY_AFFINITY_LIMIT = 512
const DEFAULT_COOLDOWN_MS = 5 * 60_000

export type AccountState = 'healthy' | 'cooling' | 'disabled'

export interface PoolAccountInput {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly enabled?: boolean
}

interface PoolAccount {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly enabled: boolean
  cooldownUntil: number
  cooldownMs: number | undefined
  lastUsedAt: number
}

export interface AccountStatus {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly enabled: boolean
  readonly state: AccountState
  readonly cooldownUntil: number | undefined
  readonly cooldownMs: number | undefined
  readonly lastUsedAt: number | undefined
}

export interface AccountPoolOptions {
  readonly distribution?: Distribution
  readonly cooldownMs?: number
}

export interface AccountPool {
  put(account: PoolAccountInput): void
  acquire(conversationKey: string | undefined, now?: number): PoolAccount | undefined
  noteServed(accountId: string): void
  noteRateLimited(accountId: string, retryAfterMs: number | undefined): void
  unbind(conversationKey: string | undefined): void
  setDistribution(next: Distribution): void
  distribution(): Distribution
  clearCooldowns(): void
  reset(): void
  describe(): readonly AccountStatus[]
}

const idleSeconds = (lastUsedAt: number, now: number): number =>
  Math.max((now - lastUsedAt) / 1000, 0)

export const createAccountPool = (options: AccountPoolOptions = {}): AccountPool => {
  const accounts = new Map<string, PoolAccount>()
  const affinity = new Map<string, string>()
  const defaultCooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
  let cursor = 0
  const requested = options.distribution ?? DEFAULT_DISTRIBUTION
  let mode: Distribution = DISTRIBUTIONS.includes(requested) ? requested : DEFAULT_DISTRIBUTION

  const eligible = (now: number): PoolAccount[] =>
    [...accounts.values()].filter(account => account.enabled && account.cooldownUntil <= now)

  const pickRoundRobin = (pool: readonly PoolAccount[]): PoolAccount | undefined => {
    const account = pool[cursor % pool.length]
    cursor = (cursor + 1) % Math.max(pool.length, 1)
    return account
  }

  /** Idle accounts weigh more, so concurrent conversations spread out. */
  const pickBalanced = (
    pool: readonly PoolAccount[],
    now: number,
  ): PoolAccount | undefined => {
    const weights = pool.map(account =>
      account.lastUsedAt === 0 ? 4 : idleSeconds(account.lastUsedAt, now),
    )
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    if (!Number.isFinite(total) || total <= 0) return pool[0]
    let roll = Math.random() * total
    for (const [index, weight] of weights.entries()) {
      roll -= weight
      if (roll < 0) return pool[index]
    }
    return pool[pool.length - 1]
  }

  const bindAffinity = (conversationKey: string | undefined, accountId: string): void => {
    if (conversationKey === undefined || conversationKey === '') return
    affinity.delete(conversationKey)
    affinity.set(conversationKey, accountId)
    while (affinity.size > STICKY_AFFINITY_LIMIT) {
      const oldest = affinity.keys().next().value
      if (oldest === undefined) break
      affinity.delete(oldest)
    }
  }

  return {
    put(account) {
      if (accounts.has(account.id)) return
      accounts.set(account.id, {
        ...account,
        enabled: account.enabled !== false,
        cooldownUntil: 0,
        cooldownMs: undefined,
        lastUsedAt: 0,
      })
    },

    /**
     * The account serving this request, or `undefined` when every account is
     * cooling down. A bound account that became ineligible is dropped and the
     * caller rebinds, which is what makes a rate-limited conversation hop to a
     * fresh account instead of failing.
     */
    acquire(conversationKey, now = Date.now()) {
      const pool = eligible(now)
      if (pool.length === 0) return undefined
      if (mode === 'sticky' && conversationKey !== undefined && conversationKey !== '') {
        const boundId = affinity.get(conversationKey)
        const bound = pool.find(account => account.id === boundId)
        if (bound !== undefined) {
          bindAffinity(conversationKey, bound.id)
          return bound
        }
        if (boundId !== undefined) affinity.delete(conversationKey)
      }
      const account =
        mode === 'balanced'
          ? pickBalanced(pool, now)
          : mode === 'priority'
            ? pool[0]
            : pickRoundRobin(pool)
      if (account === undefined) return undefined
      if (mode === 'sticky') bindAffinity(conversationKey, account.id)
      return account
    },

    /** Only after the upstream actually answered, so a failed attempt is never "used". */
    noteServed(accountId) {
      const account = accounts.get(accountId)
      if (account === undefined) return
      account.lastUsedAt = Date.now()
    },

    /**
     * Put an account in cooldown. A provider-declared `retryAfterMs` wins over
     * the configured default, so a 429 carrying a precise reset is honored exactly.
     */
    noteRateLimited(accountId, retryAfterMs) {
      const account = accounts.get(accountId)
      if (account === undefined) return
      const wait =
        retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0
          ? retryAfterMs
          : defaultCooldownMs
      account.cooldownUntil = Date.now() + wait
      account.cooldownMs = wait
    },

    unbind(conversationKey) {
      if (conversationKey === undefined) return
      affinity.delete(conversationKey)
    },

    setDistribution(next) {
      if (DISTRIBUTIONS.includes(next)) mode = next
    },

    distribution: () => mode,

    clearCooldowns() {
      for (const account of accounts.values()) {
        account.cooldownUntil = 0
        account.cooldownMs = undefined
      }
    },

    reset() {
      accounts.clear()
      affinity.clear()
      cursor = 0
    },

    describe() {
      const now = Date.now()
      return [...accounts.values()].map(account => ({
        id: account.id,
        kind: account.kind,
        label: account.label,
        enabled: account.enabled,
        state: !account.enabled
          ? ('disabled' as const)
          : account.cooldownUntil > now
            ? ('cooling' as const)
            : ('healthy' as const),
        cooldownUntil: account.cooldownUntil > now ? account.cooldownUntil : undefined,
        cooldownMs: account.cooldownMs,
        lastUsedAt: account.lastUsedAt || undefined,
      }))
    },
  }
}

/** Rate limits are quota, not transport noise: only these rotate accounts. */
const RATE_LIMIT_CODES: ReadonlySet<string> = new Set([
  'RATE_LIMIT',
  'RATE_LIMIT_EXCEEDED',
  'QUOTA_EXCEEDED',
  'ACCOUNT_QUOTA_EXCEEDED',
  'INSUFFICIENT_QUOTA',
  'USAGE_LIMIT_REACHED',
])

export interface RateLimitFailure {
  readonly code?: string
  readonly status?: number
}

export const isRateLimitFailure = (
  failure: RateLimitFailure | undefined | null,
): boolean => {
  if (failure === undefined || failure === null) return false
  if (failure.status === 429 || failure.status === 403) return true
  return failure.code !== undefined && RATE_LIMIT_CODES.has(failure.code)
}