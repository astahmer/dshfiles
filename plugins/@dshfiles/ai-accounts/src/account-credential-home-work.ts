import { AsyncLocalStorage } from 'node:async_hooks'
import { realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

interface HomeOwner {
  readonly token: symbol
  readonly exclusive: boolean
}
interface HomeWaiter {
  start(): void
}
interface HomeWork {
  owner?: HomeOwner
  readonly queue: HomeWaiter[]
}
/** Credential homes are shared across routes, aliases and Contexts. Ordinary work queues; destructive logout never waits. */
const homes = new Map<string, HomeWork>()
const ownership = new AsyncLocalStorage<ReadonlyMap<string, symbol>>()
const BUSY = 'This credential home is already in use. Wait for the active account operation to finish and retry.'
const canonicalHome = async (home: string): Promise<string> => {
  const absolute = resolve(home)
  try {
    return await realpath(absolute)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    const parent = dirname(absolute)
    if (parent === absolute) throw new Error('The credential home could not be validated.')
    return join(await canonicalHome(parent), basename(absolute))
  }
}
// realpath calls can settle out of order; queued access resolves its home in call order so the queue stays FIFO.
let accessKeyOrder: Promise<unknown> = Promise.resolve()
const canonicalHomeInCallOrder = (home: string): Promise<string> => {
  const key = accessKeyOrder.then(() => canonicalHome(home))
  accessKeyOrder = key.catch(() => undefined)
  return key
}

export class AccountCredentialHomeWork {
  /** Token refresh holds one ordinary resource owner across read/decide/persist; other normal callers wait their turn. */
  static readonly update = <Current, Next>(
    home: string,
    operations: { read(): Promise<Current>; mutate(current: Current): Promise<Next>; persist(next: Next): Promise<void> },
  ): Promise<Next> =>
    AccountCredentialHomeWork.access(home, async () => {
      const current = await operations.read()
      const next = await operations.mutate(current)
      await operations.persist(next)
      return next
    })
  static readonly isBusy = async (home: string): Promise<boolean> => {
    const state = homes.get(await canonicalHome(home))
    return state?.owner !== undefined || (state?.queue.length ?? 0) > 0
  }
  private static readonly execute = async <Result>(key: string, state: HomeWork, exclusive: boolean, work: () => Promise<Result>): Promise<Result> => {
    const token = Symbol('credential-home-owner')
    const owned = new Map(ownership.getStore())
    owned.set(key, token)
    state.owner = { token, exclusive }
    try {
      return await ownership.run(owned, work)
    } finally {
      if (state.owner?.token === token) {
        delete state.owner
        const next = state.queue.shift()
        if (next !== undefined) next.start()
        else if (homes.get(key) === state) homes.delete(key)
      }
    }
  }
  /** Logout is fail-fast even with queued readers. No implicit cancellation or delayed destructive operation. */
  static readonly run = async <Result>(home: string, work: () => Promise<Result>): Promise<Result> => {
    const key = await canonicalHome(home)
    const state = homes.get(key) ?? { queue: [] }
    const current = state.owner
    if (current !== undefined && ownership.getStore()?.get(key) === current.token) return work()
    if (current !== undefined || state.queue.length > 0) throw new Error(BUSY)
    homes.set(key, state)
    return AccountCredentialHomeWork.execute(key, state, true, work)
  }
  /** FIFO normal access is bounded to 128 waiting calls / 60 seconds. Timeout/abort removes only the waiter, never the active operation. */
  static readonly access = async <Result>(
    home: string,
    work: () => Promise<Result>,
    options: { readonly signal?: AbortSignal; readonly timeoutMs?: number } = {},
  ): Promise<Result> => {
    if (options.signal?.aborted) throw new Error('Credential access was cancelled before it started.')
    const key = await canonicalHomeInCallOrder(home)
    if (options.signal?.aborted) throw new Error('Credential access was cancelled before it started.')
    const state = homes.get(key) ?? { queue: [] }
    const current = state.owner
    if (current !== undefined && ownership.getStore()?.get(key) === current.token) return work()
    if (current?.exclusive === true) throw new Error(BUSY)
    if (current === undefined && state.queue.length === 0) {
      homes.set(key, state)
      return AccountCredentialHomeWork.execute(key, state, false, work)
    }
    if (state.queue.length >= 128) throw new Error('Too many credential operations are waiting for this home. Retry after they finish.')
    // Dispatch runs in the releasing owner's async context; preserve the waiting caller's authority, never inherit that owner's other homes.
    const callerOwnership = new Map(ownership.getStore())
    return new Promise<Result>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', abort)
      }
      const remove = (message: string): void => {
        const index = state.queue.indexOf(waiter)
        if (index === -1) return
        state.queue.splice(index, 1)
        cleanup()
        reject(new Error(message))
      }
      const abort = (): void => remove('Credential access was cancelled before it started.')
      const waiter: HomeWaiter = {
        start: () => {
          cleanup()
          // Both handlers are attached immediately; failed owners never poison or reject the remaining queue.
          void ownership.run(callerOwnership, () => AccountCredentialHomeWork.execute(key, state, false, work)).then(resolve, reject)
        },
      }
      const timer = setTimeout(
        () => remove('Credential access timed out while waiting for another operation. Retry when it finishes.'),
        options.timeoutMs ?? 60_000,
      )
      timer.unref()
      state.queue.push(waiter)
      options.signal?.addEventListener('abort', abort, { once: true })
      if (options.signal?.aborted) abort()
    })
  }
}
