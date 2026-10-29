declare const contractValue: unique symbol
declare const registryItem: unique symbol

/** A provider's state as seen by a consumer. */
export type Live<T> =
  | { readonly status: 'pending' }
  | { readonly status: 'active'; readonly value: T; readonly generation: number; readonly owner: string }
  | { readonly status: 'inactive'; readonly reason: 'disabled' | 'failed'; readonly error?: unknown }

/** A value that can be read now and observed for changes. */
export interface Subscribable<T> {
  get(): T
  subscribe(listener: () => void): () => void
}

/** Shareable id of an API one plugin provides to other plugins' browser code. */
export interface ContractToken<T, Id extends string = string> {
  readonly kind: 'contract'
  readonly id: Id
  /** Package id that may provide it; any package may when absent. */
  readonly owner?: string
  readonly [contractValue]?: T
}

/** Shareable id of a list other plugins contribute to and its owner reads. */
export interface RegistryToken<T, Id extends string = string> {
  readonly kind: 'registry'
  readonly id: Id
  readonly [registryItem]?: T
}

export type ContractValueOf<Token> = Token extends ContractToken<infer T> ? T : never
export type RegistryItemOf<Token> = Token extends RegistryToken<infer T> ? T : never

/** One contribution that threw instead of rendering, providing or computing. */
export interface ContributionFailure {
  readonly owner: string
  readonly kind: 'contract' | 'registry' | 'component' | 'setup'
  readonly id: string
  readonly message: string
  readonly at: number
}

interface ContractState {
  live: Live<unknown>
  generation: number
  readonly listeners: Set<() => void>
}

interface RegistryEntry {
  readonly owner: string
  readonly item: unknown
}

interface RegistryState {
  readonly entries: Map<number, RegistryEntry>
  snapshot: readonly unknown[]
  readonly listeners: Set<() => void>
}

interface BrokerState {
  readonly contracts: Map<string, ContractState>
  readonly registries: Map<string, RegistryState>
  readonly failures: Map<string, ContributionFailure>
  failureSnapshot: readonly ContributionFailure[]
  readonly failureListeners: Set<() => void>
  nextEntryId: number
}

const PENDING: Live<never> = Object.freeze({ status: 'pending' })
const DISABLED: Live<never> = Object.freeze({ status: 'inactive', reason: 'disabled' })

declare global {
  var __dshxBrokerV1: BrokerState | undefined
}

const createState = (): BrokerState => ({
  contracts: new Map(),
  registries: new Map(),
  failures: new Map(),
  failureSnapshot: [],
  failureListeners: new Set(),
  nextEntryId: 1,
})

/** Every plugin bundles its own dshx copy, so the broker lives on the page, not in a module. */
const brokerState = (): BrokerState => {
  globalThis.__dshxBrokerV1 ??= createState()
  return globalThis.__dshxBrokerV1
}

const notifyAll = (listeners: ReadonlySet<() => void>): void => {
  for (const listener of [...listeners]) {
    try {
      listener()
    } catch (error) {
      console.error('dshx: a broker listener threw', error)
    }
  }
}

const contractState = (id: string): ContractState => {
  const state = brokerState()
  const existing = state.contracts.get(id)
  if (existing !== undefined) return existing
  const created: ContractState = { live: PENDING, generation: 0, listeners: new Set() }
  state.contracts.set(id, created)
  return created
}

const registryState = (id: string): RegistryState => {
  const state = brokerState()
  const existing = state.registries.get(id)
  if (existing !== undefined) return existing
  const created: RegistryState = { entries: new Map(), snapshot: [], listeners: new Set() }
  state.registries.set(id, created)
  return created
}

const TOKEN_ID = /^[a-z0-9@][a-z0-9@/._-]*$/u

const assertTokenId = (id: string): void => {
  if (!TOKEN_ID.test(id)) throw new TypeError(`dshx token id ${JSON.stringify(id)} must use lowercase letters, digits, "@", "/", ".", "_" or "-".`)
}

/**
 * Declare an API one plugin provides to other plugins' browser code.
 *
 * Put tokens in a module other packages import (a dshx `modules` entry): a token
 * holds only its id, so importing it loads none of the provider's runtime.
 */
const defineContract = <T, const Id extends string = string>(id: Id, options: { readonly owner?: string } = {}): ContractToken<T, Id> => {
  assertTokenId(id)
  return Object.freeze({ kind: 'contract', id, ...(options.owner !== undefined && { owner: options.owner }) })
}

/** Declare a list other plugins contribute items to with `add` and its owner reads with `list`. */
const defineRegistry = <T, const Id extends string = string>(id: Id): RegistryToken<T, Id> => {
  assertTokenId(id)
  return Object.freeze({ kind: 'registry', id })
}

const provide = <T>(token: ContractToken<T>, value: T, owner: string): (() => void) => {
  if (token.owner !== undefined && token.owner !== owner) throw new Error(`dshx contract ${token.id} belongs to ${token.owner}; ${owner} cannot provide it.`)
  const state = contractState(token.id)
  if (state.live.status === 'active' && state.live.owner !== owner) throw new Error(`dshx contract ${token.id} is already provided by ${state.live.owner}.`)
  state.generation += 1
  const generation = state.generation
  const active: Live<T> = Object.freeze({ status: 'active', value, generation, owner })
  state.live = active
  notifyAll(state.listeners)
  return () => {
    if (state.live.status !== 'active' || state.live.generation !== generation) return
    state.live = DISABLED
    notifyAll(state.listeners)
  }
}

const failContract = (token: ContractToken<unknown>, error: unknown): void => {
  const state = contractState(token.id)
  const failed: Live<never> = Object.freeze({ status: 'inactive', reason: 'failed' as const, error })
  state.live = failed
  notifyAll(state.listeners)
}

const liveOf = <T>(token: ContractToken<T>): Subscribable<Live<T>> => {
  const state = contractState(token.id)
  return {
    // The broker stores every provider value as unknown; the token fixes its type.
    get: () => state.live as Live<T>,
    subscribe: listener => {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
  }
}

/**
 * The provider's value once it is active: at once when it already is, else when one starts. Waiting callers resolve
 * in the order they asked. Rejects with `signal.reason` when the signal aborts first.
 */
const whenActive = <T>(token: ContractToken<T>, signal: AbortSignal): Promise<T> =>
  new Promise((resolve, reject) => {
    const live = liveOf(token)
    const current = live.get()
    if (current.status === 'active') {
      resolve(current.value)
      return
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    const stop = (): void => {
      unsubscribe()
      signal.removeEventListener('abort', abort)
    }
    const abort = (): void => {
      stop()
      reject(signal.reason)
    }
    const unsubscribe = live.subscribe(() => {
      const next = live.get()
      if (next.status !== 'active') return
      stop()
      resolve(next.value)
    })
    signal.addEventListener('abort', abort, { once: true })
  })

const refreshRegistry = (state: RegistryState): void => {
  state.snapshot = Object.freeze([...state.entries.values()].map(entry => entry.item))
  notifyAll(state.listeners)
}

interface RegistryEntryHandle<T> {
  update(item: T): void
  remove(): void
}

const addEntry = <T>(token: RegistryToken<T>, item: T, owner: string): RegistryEntryHandle<T> => {
  const broker = brokerState()
  const state = registryState(token.id)
  const entryId = broker.nextEntryId
  broker.nextEntryId += 1
  state.entries.set(entryId, { owner, item })
  refreshRegistry(state)
  return {
    update: next => {
      if (!state.entries.has(entryId)) return
      state.entries.set(entryId, { owner, item: next })
      refreshRegistry(state)
    },
    remove: () => {
      if (!state.entries.delete(entryId)) return
      refreshRegistry(state)
    },
  }
}

const itemsOf = <T>(token: RegistryToken<T>): Subscribable<readonly T[]> => {
  const state = registryState(token.id)
  return {
    // Registry entries are stored as unknown; the token fixes the item type.
    get: () => state.snapshot as readonly T[],
    subscribe: listener => {
      state.listeners.add(listener)
      return () => state.listeners.delete(listener)
    },
  }
}

const failureKey = (failure: Pick<ContributionFailure, 'owner' | 'kind' | 'id'>): string => `${failure.owner}\u0000${failure.kind}\u0000${failure.id}`

const refreshFailures = (state: BrokerState): void => {
  state.failureSnapshot = Object.freeze([...state.failures.values()])
  notifyAll(state.failureListeners)
}

const reportFailure = (failure: Omit<ContributionFailure, 'at' | 'message'> & { readonly error: unknown }): void => {
  const state = brokerState()
  const message = failure.error instanceof Error ? failure.error.message : String(failure.error)
  state.failures.set(failureKey(failure), Object.freeze({ owner: failure.owner, kind: failure.kind, id: failure.id, message, at: Date.now() }))
  console.error(`dshx: ${failure.owner} ${failure.kind} ${failure.id} failed`, failure.error)
  refreshFailures(state)
}

const clearFailure = (failure: Pick<ContributionFailure, 'owner' | 'kind' | 'id'>): void => {
  const state = brokerState()
  if (state.failures.delete(failureKey(failure))) refreshFailures(state)
}

const failures: Subscribable<readonly ContributionFailure[]> = {
  get: () => brokerState().failureSnapshot,
  subscribe: listener => {
    const state = brokerState()
    state.failureListeners.add(listener)
    return () => state.failureListeners.delete(listener)
  },
}

/** Forget every contract, registry and failure; for tests that share one page. */
const resetBroker = (): void => {
  globalThis.__dshxBrokerV1 = undefined
}

export class BrowserBroker {
  static readonly defineContract = defineContract
  static readonly defineRegistry = defineRegistry
  static readonly provide = provide
  static readonly failContract = failContract
  static readonly live = liveOf
  static readonly whenActive = whenActive
  static readonly add = addEntry
  static readonly items = itemsOf
  static readonly reportFailure = reportFailure
  static readonly clearFailure = clearFailure
  static readonly failures = failures
  static readonly reset = resetBroker
}

export type { RegistryEntryHandle }
