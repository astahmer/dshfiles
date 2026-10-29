import type { CommandsService, DialogsService, LayoutService, ToastsService } from './app-services.js'
import { BrowserBroker, type ContractToken, type Live, type RegistryToken, type Subscribable } from './broker.js'

/** Reads a source and recomputes the calling item whenever that source changes. */
export type Track = <V>(source: Subscribable<V>) => V

/** A fixed item, or a function of tracked sources; returning undefined withdraws the item until it returns one again. */
export type ItemSource<T> = T | ((track: Track) => T | undefined)

/** Ends registrations made through it, and its children, at once. */
export interface PluginScope {
  readonly signal: AbortSignal
  onDispose(cleanup: () => void): void
  child(): PluginScope
  dispose(): void
}

/** Native slot registry, read structurally so a Host without one reports it instead of crashing. */
export interface NativeSlots {
  inject(name: string, register: () => unknown): unknown
  register(options: Record<string, unknown>, component: unknown): unknown
}

/** What a typed registry needs to put one item into the native UI. */
export interface NativeMountInput<T> {
  readonly item: T
  readonly owner: string
  readonly slots: NativeSlots
  readonly decorate: <Component>(component: Component) => Component
}

export type NativeMount<T> = (input: NativeMountInput<T>) => () => void

export interface PluginContextOptions {
  readonly owner: string
  readonly scope: PluginScope
  readonly slots: () => NativeSlots | undefined
  readonly decorate: <Component>(component: Component) => Component
  readonly services: PluginServices
}

/** App-level verbs every plugin gets, whichever plugin provides them. */
export interface PluginServices {
  /** Confirm, alert, prompt and select in the app's dialogs; plain browser dialogs while none is provided. */
  readonly dialogs: DialogsService
  readonly toast: ToastsService
  readonly commands: CommandsService
  readonly layout: LayoutService
}

/** The per-plugin surface every contribution goes through. */
export interface PluginContext extends PluginServices {
  /** Package id of this plugin; providers and registrants are recorded under it. */
  readonly id: string
  /** Aborted when this scope ends: plugin disposal, HMR, or the end of a `keyed` run. */
  readonly signal: AbortSignal
  /** Contribute one item; the returned function withdraws it early. */
  add<T>(registry: RegistryToken<T>, item: ItemSource<T>): () => void
  /** Every item contributed to a registry, in contribution order. */
  list<T>(registry: RegistryToken<T>): Subscribable<readonly T[]>
  /** Provide a contract; one provider at a time, withdrawn with this scope. */
  provide<T>(contract: ContractToken<T>, value: T): () => void
  /** Follow a contract another plugin provides; the same object for every call. */
  use<T>(contract: ContractToken<T>): Subscribable<Live<T>>
  /**
   * The contract's value once a provider is active, so a call made before its plugin starts runs when it does
   * (`(await api.whenActive(Contract)).open(id)`). Waits through `pending` and `inactive`; rejects with the abort reason
   * when `signal` aborts, with a `TimeoutError` after `timeoutMs`, or when this scope ends.
   */
  whenActive<T>(contract: ContractToken<T>, options?: { readonly signal?: AbortSignal; readonly timeoutMs?: number }): Promise<T>
  /** Run fn in a fresh scope for each value of source; its registrations end when the value changes. */
  keyed<K>(
    source: Subscribable<K>,
    fn: (key: K, scope: PluginContext) => void | (() => void),
    options?: { readonly equals?: (left: K, right: K) => boolean },
  ): () => void
  /** Wrap a component provided to other plugins so its hooks read this plugin's context. */
  bind<Component>(component: Component): Component
  /** Run cleanup when this scope ends. */
  onDispose(cleanup: () => void): void
}

const createScope = (): PluginScope => {
  let controller: AbortController | undefined
  let disposed = false
  const cleanups: (() => void)[] = []
  const scope: PluginScope = {
    // Created on first read: a scope that nobody asks a signal of needs no AbortController.
    get signal() {
      controller ??= new AbortController()
      if (disposed) controller.abort()
      return controller.signal
    },
    onDispose: cleanup => {
      if (disposed) {
        cleanup()
        return
      }
      cleanups.push(cleanup)
    },
    child: () => {
      const child = createScope()
      scope.onDispose(() => child.dispose())
      return child
    },
    dispose: () => {
      if (disposed) return
      disposed = true
      controller?.abort()
      for (const cleanup of cleanups.splice(0).reverse()) {
        try {
          cleanup()
        } catch (error) {
          console.error('dshx: a cleanup threw', error)
        }
      }
    },
  }
  return scope
}

/**
 * Recompute a value whenever a source it read changes.
 *
 * Changes are coalesced into one microtask so a burst of updates recomputes once.
 */
const watchComputation = <T>(input: {
  readonly compute: (track: Track) => T
  readonly onValue: (value: T) => void
  readonly onError: (error: unknown) => void
}): (() => void) => {
  const subscriptions = new Map<Subscribable<unknown>, () => void>()
  let scheduled = false
  let stopped = false
  const schedule = (): void => {
    if (scheduled || stopped) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      run()
    })
  }
  const run = (): void => {
    if (stopped) return
    const seen = new Set<Subscribable<unknown>>()
    const track: Track = source => {
      seen.add(source)
      if (!subscriptions.has(source)) subscriptions.set(source, source.subscribe(schedule))
      return source.get()
    }
    let value: T
    try {
      value = input.compute(track)
    } catch (error) {
      input.onError(error)
      return
    }
    for (const [source, unsubscribe] of subscriptions) {
      if (seen.has(source)) continue
      unsubscribe()
      subscriptions.delete(source)
    }
    input.onValue(value)
  }
  run()
  return () => {
    stopped = true
    for (const unsubscribe of subscriptions.values()) unsubscribe()
    subscriptions.clear()
  }
}

const nativeMounts = new Map<string, NativeMount<unknown>>()

/** Let a typed registry render its items into native slots wherever they are added. */
const registerNativeMount = <T>(registry: RegistryToken<T>, mount: NativeMount<T>): void => {
  // Mounts are keyed by registry id; the token fixes the item type at both ends.
  nativeMounts.set(registry.id, mount as NativeMount<unknown>)
}

const itemLabel = (item: unknown): string => {
  if (typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'string') return item.id
  return 'item'
}

const createPluginContext = (options: PluginContextOptions): PluginContext => {
  const liveCache = new Map<string, Subscribable<Live<unknown>>>()
  const listCache = new Map<string, Subscribable<readonly unknown[]>>()

  const mountNative = <T>(registry: RegistryToken<T>, item: T): (() => void) => {
    const mount = nativeMounts.get(registry.id)
    if (mount === undefined) return () => {}
    const slots = options.slots()
    if (slots === undefined) throw new Error(`dshx registry ${registry.id} needs the native "slots" service; this Host has none.`)
    return mount({ item, owner: options.owner, slots, decorate: options.decorate })
  }

  const addFixed = <T>(registry: RegistryToken<T>, item: T): (() => void) => {
    const entry = BrowserBroker.add(registry, item, options.owner)
    let unmount: () => void = () => {}
    try {
      unmount = mountNative(registry, item)
    } catch (error) {
      entry.remove()
      BrowserBroker.reportFailure({ owner: options.owner, kind: 'registry', id: `${registry.id}:${itemLabel(item)}`, error })
      return () => {}
    }
    let removed = false
    const remove = (): void => {
      if (removed) return
      removed = true
      unmount()
      entry.remove()
    }
    options.scope.onDispose(remove)
    return remove
  }

  const addReactive = <T>(registry: RegistryToken<T>, compute: (track: Track) => T | undefined): (() => void) => {
    let current: { readonly item: T; readonly remove: () => void } | undefined
    const withdraw = (): void => {
      current?.remove()
      current = undefined
    }
    const stop = watchComputation({
      compute,
      onValue: item => {
        if (item === current?.item) return
        withdraw()
        if (item === undefined) return
        current = { item, remove: addFixed(registry, item) }
      },
      onError: error => {
        withdraw()
        BrowserBroker.reportFailure({ owner: options.owner, kind: 'registry', id: registry.id, error })
      },
    })
    let stopped = false
    const remove = (): void => {
      if (stopped) return
      stopped = true
      stop()
      withdraw()
    }
    options.scope.onDispose(remove)
    return remove
  }

  const context: PluginContext = {
    ...options.services,
    id: options.owner,
    get signal() {
      return options.scope.signal
    },
    add: (registry, item) => {
      if (typeof item === 'function') {
        // An item is always an object, so a function is the reactive form by contract.
        return addReactive(registry, item as (track: Track) => never)
      }
      return addFixed(registry, item)
    },
    list: registry => {
      const cached = listCache.get(registry.id)
      if (cached !== undefined) return cached as Subscribable<readonly never[]>
      const created = BrowserBroker.items(registry)
      listCache.set(registry.id, created)
      return created
    },
    provide: (contract, value) => {
      const withdraw = BrowserBroker.provide(contract, value, options.owner)
      options.scope.onDispose(withdraw)
      return withdraw
    },
    use: contract => {
      const cached = liveCache.get(contract.id)
      if (cached !== undefined) return cached as Subscribable<Live<never>>
      const created = BrowserBroker.live(contract)
      liveCache.set(contract.id, created)
      return created
    },
    whenActive: (contract, waitOptions = {}) =>
      BrowserBroker.whenActive(
        contract,
        AbortSignal.any([
          options.scope.signal,
          ...(waitOptions.signal === undefined ? [] : [waitOptions.signal]),
          ...(waitOptions.timeoutMs === undefined ? [] : [AbortSignal.timeout(waitOptions.timeoutMs)]),
        ]),
      ),
    keyed: (source, fn, keyedOptions = {}) => {
      const equals = keyedOptions.equals ?? Object.is
      let run: { readonly key: unknown; readonly scope: PluginScope } | undefined
      const start = (key: Parameters<typeof fn>[0]): void => {
        run?.scope.dispose()
        const scope = options.scope.child()
        run = { key, scope }
        const child = createPluginContext({ ...options, scope })
        try {
          const cleanup = fn(key, child)
          if (typeof cleanup === 'function') scope.onDispose(cleanup)
        } catch (error) {
          scope.dispose()
          BrowserBroker.reportFailure({ owner: options.owner, kind: 'setup', id: 'keyed', error })
        }
      }
      start(source.get())
      const unsubscribe = source.subscribe(() => {
        const next = source.get()
        if (run !== undefined && equals(run.key as Parameters<typeof fn>[0], next)) return
        start(next)
      })
      const stop = (): void => {
        unsubscribe()
        run?.scope.dispose()
        run = undefined
      }
      options.scope.onDispose(stop)
      return stop
    },
    bind: component => options.decorate(component),
    onDispose: cleanup => options.scope.onDispose(cleanup),
  }
  return context
}

/** A constant source, for `track` and `keyed` callers that mix fixed and live values. */
const constant = <T>(value: T): Subscribable<T> => ({ get: () => value, subscribe: () => () => {} })

/** A writable source owned by one caller. */
const createSignal = <T>(initial: T): Subscribable<T> & { set(next: T): void } => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set: next => {
      if (Object.is(next, value)) return
      value = next
      for (const listener of [...listeners]) listener()
    },
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export class PluginContextModel {
  static readonly create = createPluginContext
  static readonly createScope = createScope
  static readonly watch = watchComputation
  static readonly registerNativeMount = registerNativeMount
  static readonly constant = constant
  static readonly signal = createSignal
}
