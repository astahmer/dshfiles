import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { Clock, Context, Effect, Layer, MutableRef, Random, Ref } from 'effect'
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

export interface PoolAccount {
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly enabled: boolean
  readonly cooldownUntil: number
  readonly cooldownMs: number | undefined
  readonly lastUsedAt: number
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

interface RouteBinding {
  readonly from: string
  readonly failed: string
  readonly to: string
}

/** Everything the pool knows, immutable: every transition below returns a new state. */
export interface PoolState {
  readonly accounts: ReadonlyMap<string, PoolAccount>
  /** Conversation → its sticky account, oldest first so the least recently used is evicted. */
  readonly affinity: ReadonlyMap<string, string>
  /** Conversation → the account that took over its selected route after a fail-over. */
  readonly routeBindings: ReadonlyMap<string, RouteBinding>
  readonly roundRobinCursors: ReadonlyMap<string, number>
  readonly mode: Distribution
  readonly defaultCooldownMs: number
}

export interface AcquireInput {
  readonly conversationKey?: string
  readonly candidateIds?: readonly string[]
  readonly scopeKey?: string
  readonly now?: number
}

/** The synchronous pool the routing and recovery models decide with; one call sees one consistent state. */
export interface AccountPoolView {
  put(account: PoolAccountInput): void
  replace(accounts: readonly PoolAccountInput[]): void
  acquire(input: AcquireInput): PoolAccount | undefined
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

/** Where a view reads the time and its balanced draws: the wall clock in plain code, `Clock` and `Random` in the service. */
interface PoolEnvironment {
  readonly now: () => number
  readonly random: () => number
}

const isDistribution = (value: string): value is Distribution => DISTRIBUTIONS.some(distribution => distribution === value)

const idleSeconds = (lastUsedAt: number, now: number): number => Math.max((now - lastUsedAt) / 1000, 0)

const edited = <K, V>(map: ReadonlyMap<K, V>, edit: (draft: Map<K, V>) => void): ReadonlyMap<K, V> => {
  const draft = new Map(map)
  edit(draft)
  return draft
}

const freshAccount = (input: PoolAccountInput): PoolAccount => ({
  id: input.id,
  kind: input.kind,
  label: input.label,
  enabled: input.enabled !== false,
  cooldownUntil: 0,
  cooldownMs: undefined,
  lastUsedAt: 0,
})

const updateAccount = (state: PoolState, accountId: string, change: (account: PoolAccount) => PoolAccount): PoolState => {
  const account = state.accounts.get(accountId)
  if (account === undefined) return state
  return { ...state, accounts: edited(state.accounts, draft => draft.set(accountId, change(account))) }
}

const cool = (state: PoolState, accountId: string, wait: number, now: number): PoolState =>
  updateAccount(state, accountId, account => ({ ...account, cooldownUntil: now + wait, cooldownMs: wait }))

const eligible = (state: PoolState, now: number, candidateIds?: readonly string[]): PoolAccount[] => {
  const candidates = candidateIds === undefined ? undefined : new Set(candidateIds)
  return [...state.accounts.values()].filter(
    account => account.enabled && account.cooldownUntil <= now && (candidates === undefined || candidates.has(account.id)),
  )
}

const bindAffinity = (state: PoolState, conversationKey: string | undefined, accountId: string): PoolState => {
  if (conversationKey === undefined || conversationKey === '') return state
  const affinity = edited(state.affinity, draft => {
    draft.delete(conversationKey)
    draft.set(conversationKey, accountId)
    for (const oldest of draft.keys()) {
      if (draft.size <= STICKY_AFFINITY_LIMIT) break
      draft.delete(oldest)
    }
  })
  return { ...state, affinity }
}

/** Idle accounts weigh more, so concurrent conversations spread out. */
const pickBalanced = (pool: readonly PoolAccount[], now: number, draw: () => number): PoolAccount | undefined => {
  const weights = pool.map(account => (account.lastUsedAt === 0 ? 4 : idleSeconds(account.lastUsedAt, now)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (!Number.isFinite(total) || total <= 0) return pool[0]
  let roll = draw() * total
  for (const [index, weight] of weights.entries()) {
    roll -= weight
    if (roll < 0) return pool[index]
  }
  return pool[pool.length - 1]
}

/** The pool's transitions as pure functions of its state, the time and one random draw. */
export class AccountPoolModel {
  static initial(options: AccountPoolOptions = {}): PoolState {
    const requested = options.distribution ?? DEFAULT_DISTRIBUTION
    return {
      accounts: new Map(),
      affinity: new Map(),
      routeBindings: new Map(),
      roundRobinCursors: new Map(),
      mode: isDistribution(requested) ? requested : DEFAULT_DISTRIBUTION,
      defaultCooldownMs: options.cooldownMs ?? DEFAULT_COOLDOWN_MS,
    }
  }

  static put(state: PoolState, account: PoolAccountInput): PoolState {
    if (state.accounts.has(account.id)) return state
    return { ...state, accounts: edited(state.accounts, draft => draft.set(account.id, freshAccount(account))) }
  }

  static replace(state: PoolState, nextAccounts: readonly PoolAccountInput[]): PoolState {
    const accounts = new Map<string, PoolAccount>()
    for (const input of nextAccounts) {
      const existing = state.accounts.get(input.id)
      accounts.set(
        input.id,
        existing === undefined ? freshAccount(input) : { ...existing, kind: input.kind, label: input.label, enabled: input.enabled !== false },
      )
    }
    const enabled = (accountId: string): boolean => accounts.get(accountId)?.enabled === true
    return {
      ...state,
      accounts,
      affinity: new Map([...state.affinity].filter(([, accountId]) => enabled(accountId))),
      routeBindings: new Map([...state.routeBindings].filter(([, binding]) => enabled(binding.failed) && enabled(binding.to))),
    }
  }

  /**
   * The account serving this request, or `undefined` when every account is
   * cooling down. A bound account that became ineligible is dropped and the
   * caller rebinds, which is what makes a rate-limited conversation hop to a
   * fresh account instead of failing.
   */
  static acquire(state: PoolState, input: AcquireInput, now: number, draw: () => number): readonly [PoolAccount | undefined, PoolState] {
    const pool = eligible(state, now, input.candidateIds)
    if (pool.length === 0) return [undefined, state]
    const conversationKey = input.conversationKey
    let next = state
    if (state.mode === 'sticky' && conversationKey !== undefined && conversationKey !== '') {
      const boundId = state.affinity.get(conversationKey)
      const bound = pool.find(account => account.id === boundId)
      if (bound !== undefined) return [bound, bindAffinity(state, conversationKey, bound.id)]
      if (boundId !== undefined) next = { ...state, affinity: edited(state.affinity, draft => draft.delete(conversationKey)) }
    }
    if (state.mode === 'balanced') return [pickBalanced(pool, now, draw), next]
    if (state.mode === 'priority') return [pool[0], next]
    const scopeKey = input.scopeKey ?? 'all'
    const cursor = next.roundRobinCursors.get(scopeKey) ?? 0
    const account = pool[cursor % pool.length]
    next = { ...next, roundRobinCursors: edited(next.roundRobinCursors, draft => draft.set(scopeKey, (cursor + 1) % Math.max(pool.length, 1))) }
    if (account === undefined) return [undefined, next]
    return [account, next.mode === 'sticky' ? bindAffinity(next, conversationKey, account.id) : next]
  }

  /** Only after the upstream actually answered, so a failed attempt is never "used". */
  static noteServed(state: PoolState, accountId: string, now: number): PoolState {
    return updateAccount(state, accountId, account => ({ ...account, lastUsedAt: now }))
  }

  /**
   * Put an account in cooldown. A provider-declared `retryAfterMs` wins over
   * the configured default, so a 429 carrying a precise reset is honored exactly.
   */
  static noteRateLimited(state: PoolState, accountId: string, retryAfterMs: number | undefined, now: number): PoolState {
    const wait = retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0 ? retryAfterMs : state.defaultCooldownMs
    return cool(state, accountId, wait, now)
  }

  /**
   * A reset the provider declared in its failure text ("Try again in ~242 min", "resets 2:10am").
   * The configured cooldown is the floor, so a short hint never shortens a normal cooldown, and a
   * plan is never cooled for more than a day.
   */
  static noteDeclaredReset(state: PoolState, accountId: string, waitMs: number, now: number): PoolState {
    const requested = Number.isFinite(waitMs) && waitMs > 0 ? waitMs : state.defaultCooldownMs
    return cool(state, accountId, Math.min(Math.max(requested, state.defaultCooldownMs), MAX_RESET_WAIT_MS), now)
  }

  static isHealthy(state: PoolState, accountId: string, now: number): boolean {
    const account = state.accounts.get(accountId)
    return account !== undefined && account.enabled && account.cooldownUntil <= now
  }

  static bindRoute(state: PoolState, conversationKey: string, from: string, to: string, failed: string): PoolState {
    const routeBindings = edited(state.routeBindings, draft => {
      if (from === to) draft.delete(conversationKey)
      else draft.set(conversationKey, { from, failed, to })
    })
    return { ...state, routeBindings }
  }

  /**
   * The account that serves a conversation's selected route on the wire. A
   * fail-over holds until the account that failed recovers, even when request
   * distribution selected a different physical account than the picker route.
   * A binding that no longer holds is dropped from the returned state.
   */
  static routeFor(state: PoolState, conversationKey: string | undefined, provider: string, now: number): readonly [string, PoolState] {
    if (conversationKey === undefined) return [provider, state]
    const binding = state.routeBindings.get(conversationKey)
    if (binding === undefined || binding.from !== provider) return [provider, state]
    const failed = state.accounts.get(binding.failed)
    const standIn = state.accounts.get(binding.to)
    if (failed?.enabled !== true || failed.cooldownUntil <= now || standIn?.enabled !== true) {
      return [provider, { ...state, routeBindings: edited(state.routeBindings, draft => draft.delete(conversationKey)) }]
    }
    return [binding.to, state]
  }

  static unbind(state: PoolState, conversationKey: string | undefined): PoolState {
    if (conversationKey === undefined) return state
    return {
      ...state,
      affinity: edited(state.affinity, draft => draft.delete(conversationKey)),
      routeBindings: edited(state.routeBindings, draft => draft.delete(conversationKey)),
    }
  }

  static setDistribution(state: PoolState, next: string): PoolState {
    return isDistribution(next) ? { ...state, mode: next } : state
  }

  static clearCooldowns(state: PoolState): PoolState {
    return { ...state, accounts: new Map([...state.accounts].map(([id, account]) => [id, { ...account, cooldownUntil: 0, cooldownMs: undefined }])) }
  }

  static reset(state: PoolState): PoolState {
    return { ...AccountPoolModel.initial({ distribution: state.mode, cooldownMs: state.defaultCooldownMs }) }
  }

  static describe(state: PoolState, now: number): readonly AccountStatus[] {
    return [...state.accounts.values()].map(account => ({
      id: account.id,
      kind: account.kind,
      label: account.label,
      enabled: account.enabled,
      state: !account.enabled ? ('disabled' as const) : account.cooldownUntil > now ? ('cooling' as const) : ('healthy' as const),
      cooldownUntil: account.cooldownUntil > now ? account.cooldownUntil : undefined,
      cooldownMs: account.cooldownMs,
      lastUsedAt: account.lastUsedAt || undefined,
    }))
  }

  /** A synchronous view over one state cell; every call applies its transition to the cell at once. */
  static view(cell: { readonly get: () => PoolState; readonly set: (next: PoolState) => void }, environment: PoolEnvironment): AccountPoolView {
    const apply = (transition: (state: PoolState) => PoolState): void => cell.set(transition(cell.get()))
    const decide = <A>(transition: (state: PoolState) => readonly [A, PoolState]): A => {
      const [result, next] = transition(cell.get())
      cell.set(next)
      return result
    }
    return {
      put: account => apply(state => AccountPoolModel.put(state, account)),
      replace: accounts => apply(state => AccountPoolModel.replace(state, accounts)),
      acquire: input => decide(state => AccountPoolModel.acquire(state, input, input.now ?? environment.now(), environment.random)),
      noteServed: accountId => apply(state => AccountPoolModel.noteServed(state, accountId, environment.now())),
      noteRateLimited: (accountId, retryAfterMs, now = environment.now()) =>
        apply(state => AccountPoolModel.noteRateLimited(state, accountId, retryAfterMs, now)),
      noteDeclaredReset: (accountId, waitMs, now = environment.now()) => apply(state => AccountPoolModel.noteDeclaredReset(state, accountId, waitMs, now)),
      isHealthy: (accountId, now = environment.now()) => AccountPoolModel.isHealthy(cell.get(), accountId, now),
      bindRoute: (conversationKey, from, to, failedAccountId = from) =>
        apply(state => AccountPoolModel.bindRoute(state, conversationKey, from, to, failedAccountId)),
      routeFor: (conversationKey, provider, now = environment.now()) => decide(state => AccountPoolModel.routeFor(state, conversationKey, provider, now)),
      unbind: conversationKey => apply(state => AccountPoolModel.unbind(state, conversationKey)),
      setDistribution: next => apply(state => AccountPoolModel.setDistribution(state, next)),
      distribution: () => cell.get().mode,
      clearCooldowns: () => apply(AccountPoolModel.clearCooldowns),
      reset: () => apply(AccountPoolModel.reset),
      describe: () => AccountPoolModel.describe(cell.get(), environment.now()),
    }
  }
}

/** A standalone pool on the wall clock and `Math.random`, for code and tests outside the plugin services. */
export const createAccountPool = (options: AccountPoolOptions = {}): AccountPoolView => {
  let state = AccountPoolModel.initial(options)
  return AccountPoolModel.view(
    {
      get: () => state,
      set: next => {
        state = next
      },
    },
    { now: Date.now, random: Math.random },
  )
}

/**
 * The plugin's one account pool: its state lives in a `Ref`, time comes from `Clock` and balanced draws from
 * `Random`. `view` is the synchronous pool over that same `Ref` for the decisions a synchronous Cordis hook or the
 * routing and recovery models make; each call applies its transition at once, so a decision is never torn.
 */
export class AccountPool extends Context.Service<
  AccountPool,
  {
    readonly view: AccountPoolView
    readonly transact: <A>(decide: (pool: AccountPoolView) => A) => Effect.Effect<A>
    readonly replace: (accounts: readonly PoolAccountInput[]) => Effect.Effect<void>
    readonly setDistribution: (next: Distribution) => Effect.Effect<void>
    readonly noteServed: (accountId: string) => Effect.Effect<void>
    readonly distribution: Effect.Effect<Distribution>
    readonly describe: Effect.Effect<readonly AccountStatus[]>
  }
>()('@dshfiles/ai-accounts/AccountPool') {
  static readonly make = Effect.fnUntraced(function* (options: AccountPoolOptions & { readonly accounts: readonly PoolAccountInput[] }) {
    const state = yield* Ref.make(options.accounts.reduce(AccountPoolModel.put, AccountPoolModel.initial(options)))
    const clock = yield* Clock.Clock
    const random = yield* Random.Random
    const view = AccountPoolModel.view(
      { get: () => Ref.getUnsafe(state), set: next => MutableRef.set(state.ref, next) },
      { now: () => clock.currentTimeMillisUnsafe(), random: () => random.nextDoubleUnsafe() },
    )
    return AccountPool.of({
      view,
      transact: decide => Effect.sync(() => decide(view)),
      replace: Effect.fn('ai-accounts pool replace')(function* (accounts: readonly PoolAccountInput[]) {
        yield* Ref.update(state, current => AccountPoolModel.replace(current, accounts))
      }),
      setDistribution: Effect.fn('ai-accounts pool set distribution')(function* (next: Distribution) {
        yield* Ref.update(state, current => AccountPoolModel.setDistribution(current, next))
      }),
      noteServed: Effect.fn('ai-accounts pool note served')(function* (accountId: string) {
        const now = yield* Clock.currentTimeMillis
        yield* Ref.update(state, current => AccountPoolModel.noteServed(current, accountId, now))
      }),
      distribution: Effect.map(Ref.get(state), current => current.mode),
      describe: Effect.flatMap(Ref.get(state), current => Effect.map(Clock.currentTimeMillis, now => AccountPoolModel.describe(current, now))),
    })
  })

  static readonly layer = (options: AccountPoolOptions & { readonly accounts: readonly PoolAccountInput[] }) =>
    Layer.effect(AccountPool, AccountPool.make(options))
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
  credit: { readonly pool: { readonly noteServed: (accountId: string) => void }; readonly accountId: string | undefined },
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
