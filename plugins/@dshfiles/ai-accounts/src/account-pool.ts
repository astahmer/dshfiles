import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { MAX_RESET_WAIT_MS } from './reset-hint.js'
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
 * Distribution only picks which healthy account serves the next request; it
 * never decides whether to fail over. That is `failure-recovery.ts`, which
 * cools a failed account here and binds the conversation to a stand-in.
 */

const DISTRIBUTIONS = ['sticky', 'priority', 'round-robin', 'balanced'] as const
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
  replace(accounts: readonly PoolAccountInput[]): void
  acquire(input: {
    readonly conversationKey?: string
    readonly candidateIds?: readonly string[]
    readonly scopeKey?: string
    readonly now?: number
  }): PoolAccount | undefined
  noteServed(accountId: string): void
  noteRateLimited(accountId: string, retryAfterMs: number | undefined, now?: number): void
  /** Cool an account until the reset its provider declared, floored at the configured cooldown and capped at a day. */
  noteDeclaredReset(accountId: string, waitMs: number, now?: number): void
  isHealthy(accountId: string, now?: number): boolean
  bindRoute(conversationKey: string, from: string, to: string, failedAccountId?: string): void
  routeFor(conversationKey: string | undefined, provider: string, now?: number): string
  unbind(conversationKey: string | undefined): void
  setDistribution(next: Distribution): void
  distribution(): Distribution
  clearCooldowns(): void
  reset(): void
  describe(): readonly AccountStatus[]
}

const idleSeconds = (lastUsedAt: number, now: number): number => Math.max((now - lastUsedAt) / 1000, 0)

export const createAccountPool = (options: AccountPoolOptions = {}): AccountPool => {
  const accounts = new Map<string, PoolAccount>()
  const affinity = new Map<string, string>()
  /** Conversation → the account that took over its selected route after a fail-over. */
  const routeBindings = new Map<string, { readonly from: string; readonly failed: string; readonly to: string }>()
  const defaultCooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS
  const roundRobinCursors = new Map<string, number>()
  const requested = options.distribution ?? DEFAULT_DISTRIBUTION
  let mode: Distribution = DISTRIBUTIONS.includes(requested) ? requested : DEFAULT_DISTRIBUTION

  const eligible = (now: number, candidateIds?: readonly string[]): PoolAccount[] => {
    const candidates = candidateIds === undefined ? undefined : new Set(candidateIds)
    return [...accounts.values()].filter(account => account.enabled && account.cooldownUntil <= now && (candidates === undefined || candidates.has(account.id)))
  }

  const pickRoundRobin = (pool: readonly PoolAccount[], scopeKey: string): PoolAccount | undefined => {
    const cursor = roundRobinCursors.get(scopeKey) ?? 0
    const account = pool[cursor % pool.length]
    roundRobinCursors.set(scopeKey, (cursor + 1) % Math.max(pool.length, 1))
    return account
  }

  /** Idle accounts weigh more, so concurrent conversations spread out. */
  const pickBalanced = (pool: readonly PoolAccount[], now: number): PoolAccount | undefined => {
    const weights = pool.map(account => (account.lastUsedAt === 0 ? 4 : idleSeconds(account.lastUsedAt, now)))
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

    replace(nextAccounts) {
      const reconciled = new Map<string, PoolAccount>()
      for (const input of nextAccounts) {
        const existing = accounts.get(input.id)
        reconciled.set(
          input.id,
          existing === undefined
            ? {
                ...input,
                enabled: input.enabled !== false,
                cooldownUntil: 0,
                cooldownMs: undefined,
                lastUsedAt: 0,
              }
            : {
                ...existing,
                kind: input.kind,
                label: input.label,
                enabled: input.enabled !== false,
              },
        )
      }

      accounts.clear()
      for (const [id, account] of reconciled) accounts.set(id, account)
      for (const [conversationKey, accountId] of affinity) {
        if (reconciled.get(accountId)?.enabled !== true) affinity.delete(conversationKey)
      }
      for (const [conversationKey, binding] of routeBindings) {
        if (reconciled.get(binding.failed)?.enabled !== true || reconciled.get(binding.to)?.enabled !== true) routeBindings.delete(conversationKey)
      }
    },

    /**
     * The account serving this request, or `undefined` when every account is
     * cooling down. A bound account that became ineligible is dropped and the
     * caller rebinds, which is what makes a rate-limited conversation hop to a
     * fresh account instead of failing.
     */
    acquire(input) {
      const now = input.now ?? Date.now()
      const pool = eligible(now, input.candidateIds)
      if (pool.length === 0) return undefined
      const conversationKey = input.conversationKey
      if (mode === 'sticky' && conversationKey !== undefined && conversationKey !== '') {
        const boundId = affinity.get(conversationKey)
        const bound = pool.find(account => account.id === boundId)
        if (bound !== undefined) {
          bindAffinity(conversationKey, bound.id)
          return bound
        }
        if (boundId !== undefined) affinity.delete(conversationKey)
      }
      const scopeKey = input.scopeKey ?? 'all'
      const account = mode === 'balanced' ? pickBalanced(pool, now) : mode === 'priority' ? pool[0] : pickRoundRobin(pool, scopeKey)
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
    noteRateLimited(accountId, retryAfterMs, now = Date.now()) {
      const account = accounts.get(accountId)
      if (account === undefined) return
      const wait = retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : defaultCooldownMs
      account.cooldownUntil = now + wait
      account.cooldownMs = wait
    },

    /**
     * A reset the provider declared in its failure text ("Try again in ~242 min", "resets 2:10am").
     * The configured cooldown is the floor, so a short hint never shortens a normal cooldown, and a
     * plan is never cooled for more than a day.
     */
    noteDeclaredReset(accountId, waitMs, now = Date.now()) {
      const account = accounts.get(accountId)
      if (account === undefined) return
      const requested = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : defaultCooldownMs
      const wait = Math.min(Math.max(requested, defaultCooldownMs), MAX_RESET_WAIT_MS)
      account.cooldownUntil = now + wait
      account.cooldownMs = wait
    },

    isHealthy(accountId, now = Date.now()) {
      const account = accounts.get(accountId)
      return account !== undefined && account.enabled && account.cooldownUntil <= now
    },

    bindRoute(conversationKey, from, to, failedAccountId = from) {
      if (from === to) routeBindings.delete(conversationKey)
      else routeBindings.set(conversationKey, { from, failed: failedAccountId, to })
    },

    /**
     * The account that serves a conversation's selected route on the wire. A
     * fail-over holds until the account that failed recovers, even when request
     * distribution selected a different physical account than the picker route.
     */
    routeFor(conversationKey, provider, now = Date.now()) {
      if (conversationKey === undefined) return provider
      const binding = routeBindings.get(conversationKey)
      if (binding === undefined || binding.from !== provider) return provider
      const failed = accounts.get(binding.failed)
      const standIn = accounts.get(binding.to)
      if (failed?.enabled !== true || failed.cooldownUntil <= now || standIn?.enabled !== true) {
        routeBindings.delete(conversationKey)
        return provider
      }
      return binding.to
    },

    unbind(conversationKey) {
      if (conversationKey === undefined) return
      affinity.delete(conversationKey)
      routeBindings.delete(conversationKey)
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
      routeBindings.clear()
      roundRobinCursors.clear()
    },

    describe() {
      const now = Date.now()
      return [...accounts.values()].map(account => ({
        id: account.id,
        kind: account.kind,
        label: account.label,
        enabled: account.enabled,
        state: !account.enabled ? ('disabled' as const) : account.cooldownUntil > now ? ('cooling' as const) : ('healthy' as const),
        cooldownUntil: account.cooldownUntil > now ? account.cooldownUntil : undefined,
        cooldownMs: account.cooldownMs,
        lastUsedAt: account.lastUsedAt || undefined,
      }))
    },
  }
}

/**
 * Pass one attempt's chunks through untouched and credit the account only once
 * the attempt finishes without an error. The terminal `finish` must always reach
 * the agent loop: a stream that ends without one reads as a completed step, so
 * an idle timeout or quota error would end the turn silently instead of being
 * retried or failed over.
 */
export async function* creditServedAttempt(
  chunks: AsyncIterable<StreamChunk>,
  credit: { readonly pool: Pick<AccountPool, 'noteServed'>; readonly accountId: string | undefined },
): AsyncIterable<StreamChunk> {
  let usageSeen = false
  for await (const chunk of chunks) {
    if (chunk.type === 'usage') usageSeen = true
    if (chunk.type === 'finish' && chunk.reason.kind !== 'error' && usageSeen && credit.accountId !== undefined) {
      credit.pool.noteServed(credit.accountId)
    }
    yield chunk
  }
}
