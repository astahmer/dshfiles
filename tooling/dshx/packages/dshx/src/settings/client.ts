import type { ReactNode } from 'react'
import type z from '@deepseek-ai/schemastery'
import type { ConfigForms as OfficialConfigForms, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SettingsContract, SettingsReadError, SettingsState, SettingsValue } from './types.js'

type ReactRuntime = typeof import('react')
declare const require: ((name: string) => ReactRuntime) | undefined

interface ScopeSnapshot<T> {
  readonly status: 'loading' | 'ready' | 'unavailable'
  readonly value: T | undefined
  readonly base: unknown
  readonly user: unknown
  readonly revision: number | undefined
  readonly writable: boolean
  readonly mode: 'host' | 'memory'
}

interface Scope<T> {
  getSnapshot(): ScopeSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
  unset(field: string): Promise<boolean>
}

interface NamespaceView {
  readonly ns: string
  readonly applies: 'live' | 'restart'
  readonly secrets: readonly {
    readonly path: readonly string[]
    readonly set: boolean
  }[]
  readonly revision: number
}

interface DescribeSnapshot {
  readonly status: 'idle' | 'loading' | 'ready' | 'unavailable'
  readonly view:
    | {
        readonly namespaces: readonly NamespaceView[]
        readonly writable: boolean
      }
    | undefined
  readonly error: string | null
}

interface DescribeFace {
  getSnapshot(): DescribeSnapshot
  subscribe(listener: () => void): () => void
  ensure(): Promise<void>
}

/**
 * Protocol 2 replaced per-namespace binders with one shared form provider: a
 * namespace is a Host entry id, `get` returns its form, and `describe` is the
 * cross-namespace mirror every consumer already derives from.
 */
type SettingsFormProvider = Pick<OfficialConfigForms, 'get' | 'describe'>

interface ContextLike {
  get(name: string): unknown
}

interface Binding<T> {
  readonly scope: Scope<T>
  readonly describe: DescribeFace
}

export interface SettingsClientRuntime {
  binding<T extends object>(contract: SettingsContract<z<any, object>, T>): Binding<T>
}

let react: ReactRuntime | undefined
let settingsContext: import('react').Context<SettingsClientRuntime | undefined> | undefined

function runtime(): ReactRuntime {
  if (react !== undefined) return react
  const loader = typeof require === 'function' ? require : (globalThis as { require?: (name: string) => ReactRuntime }).require
  if (typeof loader !== 'function') throw new Error('React runtime is unavailable for Settings hooks.')
  react = loader('react')
  return react
}

function context(): import('react').Context<SettingsClientRuntime | undefined> {
  if (settingsContext !== undefined) return settingsContext
  settingsContext = runtime().createContext<SettingsClientRuntime | undefined>(undefined)
  return settingsContext
}

function unavailableScope<T>(message: string): Scope<T> {
  const snapshot: ScopeSnapshot<T> = {
    status: 'unavailable',
    value: undefined,
    base: undefined,
    user: undefined,
    revision: undefined,
    writable: false,
    mode: 'memory',
  }
  const reject = (): Promise<boolean> => Promise.reject(new Error(message))
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    set: reject,
    unset: reject,
  }
}

function unavailableDescribe(message: string): DescribeFace {
  const snapshot: DescribeSnapshot = {
    status: 'unavailable',
    view: undefined,
    error: message,
  }
  return {
    getSnapshot: () => snapshot,
    subscribe: () => () => undefined,
    ensure: () => Promise.resolve(),
  }
}

/** Create one per-Client identity map over official Settings scopes. */
export function createSettingsClientRuntime(ctx: ContextLike): SettingsClientRuntime {
  const forms = ctx.get('configForms') as SettingsFormProvider | undefined
  const missing = 'The official ConfigForms service is unavailable. Add @deepseek-ai/dsh-client-ui-settings to dsh.client.inject.'
  const describe = (forms?.describe() ?? unavailableDescribe(missing)) as DescribeFace
  const bindings = new Map<object, Binding<unknown>>()
  return {
    binding<T extends object>(contract: SettingsContract<z<any, object>, T>): Binding<T> {
      const existing = bindings.get(contract)
      if (existing !== undefined) return existing as Binding<T>
      const source = forms?.get<unknown>(contract.namespace) ?? unavailableScope<unknown>(missing)
      let previous: ConfigFormSnapshot<unknown> | undefined
      let snapshot: ScopeSnapshot<T>
      const scope: Scope<T> = {
        subscribe: listener => source.subscribe(listener),
        set: (field, value) => source.set(field, value),
        unset: field => source.unset(field),
        getSnapshot() {
          const next = source.getSnapshot()
          if (next !== previous) {
            previous = next
            try {
              const value =
                next.status !== 'ready' ? undefined : contract.client === undefined ? (contract.schema(next.value) as T) : contract.client.decode(next.value)
              snapshot = { ...next, value, mode: 'host' }
            } catch {
              snapshot = { ...next, value: undefined, status: 'unavailable', mode: 'host' }
            }
          }
          return snapshot
        },
      }
      const binding = { scope, describe }
      bindings.set(contract, binding as Binding<unknown>)
      return binding
    },
  }
}

/** Wrap a Slot component with the Settings runtime owned by its Client Fiber. */
export function provideSettingsContext(component: (props: any) => ReactNode, client: SettingsClientRuntime): (props: any) => ReactNode {
  return (props: any) => runtime().createElement(context().Provider, { value: client }, runtime().createElement(component, props))
}

function readError(
  contract: { readonly namespace: string },
  scope: ScopeSnapshot<unknown>,
  mirror: DescribeSnapshot,
  view: NamespaceView | undefined,
): SettingsReadError | null {
  if (mirror.status === 'unavailable') {
    return {
      kind: 'provider-unavailable',
      message: mirror.error ?? 'The official Settings provider is unavailable.',
    }
  }
  if (mirror.error !== null) return { kind: 'sync-failed', message: mirror.error }
  if (mirror.status === 'ready' && view === undefined) {
    return {
      kind: 'namespace-unregistered',
      message: `Settings namespace ${JSON.stringify(contract.namespace)} is not registered by the active Host. Add the contract to defineHost({ settings: [...] }).`,
    }
  }
  if (view !== undefined && scope.status !== 'ready' && scope.revision === view.revision) {
    return {
      kind: 'decode-failed',
      message: `Settings namespace ${JSON.stringify(contract.namespace)} could not decode its redacted Client value.`,
    }
  }
  return null
}

/** Read and mutate one Settings contract through the official shared Client mirror. */
export function useSettings<Schema extends z<any, object>, ClientValue extends object>(
  contract: SettingsContract<Schema, ClientValue>,
): SettingsState<SettingsValue<Schema>, ClientValue> {
  const client = runtime().useContext(context())
  if (client === undefined) {
    throw new Error(`Settings ${JSON.stringify(contract.namespace)} is unavailable outside a DSHX Client Slot component.`)
  }
  const binding = runtime().useMemo(() => client.binding(contract), [client, contract])
  const scope = runtime().useSyncExternalStore(
    listener => binding.scope.subscribe(listener),
    () => binding.scope.getSnapshot(),
    () => binding.scope.getSnapshot(),
  )
  const mirror = runtime().useSyncExternalStore(
    listener => binding.describe.subscribe(listener),
    () => binding.describe.getSnapshot(),
    () => binding.describe.getSnapshot(),
  )
  runtime().useEffect(() => {
    void binding.describe.ensure()
  }, [binding])

  const namespaceView = mirror.view?.namespaces.find(item => item.ns === contract.namespace)
  const error = readError(contract, scope, mirror, namespaceView)
  const [mutationPending, setMutationPending] = runtime().useState(false)
  const pending = runtime().useRef(0)
  const mounted = runtime().useRef(true)
  runtime().useEffect(
    () => () => {
      mounted.current = false
    },
    [],
  )

  const mutate = runtime().useCallback(
    async (operation: () => Promise<boolean>): Promise<boolean> => {
      pending.current += 1
      setMutationPending(true)
      try {
        return await operation()
      } finally {
        pending.current -= 1
        if (mounted.current) setMutationPending(pending.current > 0)
      }
    },
    [binding],
  )

  const writable =
    scope.writable &&
    mirror.view?.writable === true &&
    namespaceView !== undefined &&
    error?.kind !== 'provider-unavailable' &&
    error?.kind !== 'namespace-unregistered'
  const status =
    error?.kind === 'provider-unavailable' || error?.kind === 'namespace-unregistered' || error?.kind === 'decode-failed' ? 'unavailable' : scope.status
  const assertAvailable = runtime().useCallback(() => {
    if (!writable) throw new Error(error?.message ?? `Settings namespace ${JSON.stringify(contract.namespace)} is not writable.`)
  }, [contract.namespace, error, writable])

  const set = runtime().useCallback(
    <Key extends keyof SettingsValue<Schema> & string>(field: Key, value: SettingsValue<Schema>[Key]) =>
      mutate(async () => {
        assertAvailable()
        return binding.scope.set(field, value)
      }),
    [assertAvailable, binding, mutate],
  )
  const unset = runtime().useCallback(
    <Key extends keyof SettingsValue<Schema> & string>(field: Key) =>
      mutate(async () => {
        assertAvailable()
        return binding.scope.unset(field)
      }),
    [assertAvailable, binding, mutate],
  )
  return {
    status,
    value: scope.value,
    revision: scope.revision,
    writable,
    mode: scope.mode,
    applies: namespaceView === undefined ? contract.applies : 'live',
    secrets: namespaceView?.secrets ?? [],
    error,
    mutation: { pending: mutationPending },
    set,
    unset,
  }
}
