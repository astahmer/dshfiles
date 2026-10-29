import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentType,
  type Context,
  type ReactNode,
} from 'react'
import { BrowserBroker, type ContractToken, type ContributionFailure, type Live, type RegistryToken, type Subscribable } from './broker.js'
import type { PluginContext } from './plugin-context.js'

/** Whatever props the wrapped component takes; the wrapper forwards them untouched. */
type ProvidedProps = Readonly<Record<string, unknown>>

let pluginReactContext: Context<PluginContext | undefined> | undefined

/** Created on first use: a bundle evaluates before the Host hands it React. */
const reactContext = (): Context<PluginContext | undefined> => {
  pluginReactContext ??= createContext<PluginContext | undefined>(undefined)
  return pluginReactContext
}

const providedComponents = new WeakMap<PluginContext, WeakMap<object, ComponentType<never>>>()

/** Wrap a component so `usePlugin()` inside it returns this plugin's context, wherever it renders. */
const providePlugin = <Component>(component: Component, plugin: PluginContext): Component => {
  if (typeof component !== 'function') return component
  const byComponent = providedComponents.get(plugin) ?? new WeakMap<object, ComponentType<never>>()
  providedComponents.set(plugin, byComponent)
  const existing = byComponent.get(component)
  // Wrappers are cached per component, so the cached one keeps its type.
  if (existing !== undefined) return existing as Component
  const Inner = component as ComponentType<ProvidedProps>
  const Provided = (props: ProvidedProps): ReactNode => createElement(reactContext().Provider, { value: plugin }, createElement(Inner, props))
  Provided.displayName = `WithPlugin(${Inner.displayName ?? Inner.name ?? 'Component'})`
  byComponent.set(component, Provided)
  return Provided as Component
}

/** The context of the plugin that registered the rendering component. */
const usePlugin = (): PluginContext => {
  const plugin = useContext(reactContext())
  if (plugin === undefined) throw new Error('usePlugin() must run inside a component registered through dshx (a slot, a registry item or plugin.bind).')
  return plugin
}

/** Read a subscribable value and re-render when it changes. */
const useSubscribable = <T>(source: Subscribable<T>): T => useSyncExternalStore(source.subscribe, source.get, source.get)

/** Follow another plugin's contract: pending, active with its value, or inactive. */
const useContract = <T>(contract: ContractToken<T>): Live<T> => {
  const source = useRef(BrowserBroker.live(contract))
  return useSubscribable(source.current)
}

/** Every item contributed to a registry. */
const useRegistry = <T>(registry: RegistryToken<T>): readonly T[] => {
  const source = useRef(BrowserBroker.items(registry))
  return useSubscribable(source.current)
}

/** Contributions that threw, by owner, kind and id. */
const useContributionFailures = (): readonly ContributionFailure[] => useSubscribable(BrowserBroker.failures)

/**
 * Run work once per key, aborting the previous run's signal when the key changes or the component unmounts.
 *
 * Unlike a bare effect, the signal makes a late result from an old key easy to drop.
 */
const useKeyed = <K>(key: K, run: (key: K, signal: AbortSignal) => void | (() => void)): void => {
  const latestRun = useRef(run)
  latestRun.current = run
  useEffect(() => {
    const controller = new AbortController()
    const cleanup = latestRun.current(key, controller.signal)
    return () => {
      controller.abort()
      if (typeof cleanup === 'function') cleanup()
    }
  }, [key])
}

export type LatestState<T> =
  | { readonly status: 'idle'; readonly data: undefined; readonly error: undefined }
  | { readonly status: 'loading'; readonly data: T | undefined; readonly error: undefined }
  | { readonly status: 'success'; readonly data: T; readonly error: undefined }
  | { readonly status: 'error'; readonly data: T | undefined; readonly error: unknown }

const IDLE = { status: 'idle', data: undefined, error: undefined } as const

/**
 * Load the value for the latest key only. A result for a key that is no longer
 * current is dropped, and its request's signal is aborted. An undefined key stays idle.
 */
const useLatest = <K, T>(key: K | undefined, load: (key: K, signal: AbortSignal) => Promise<T>): LatestState<T> => {
  const [state, setState] = useState<LatestState<T>>(IDLE)
  const latestLoad = useRef(load)
  latestLoad.current = load
  useEffect(() => {
    if (key === undefined) {
      setState(IDLE)
      return
    }
    const controller = new AbortController()
    setState(previous => ({ status: 'loading', data: previous.data, error: undefined }))
    latestLoad
      .current(key, controller.signal)
      .then(data => {
        if (!controller.signal.aborted) setState({ status: 'success', data, error: undefined })
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setState(previous => ({ status: 'error', data: previous.data, error }))
      })
    return () => controller.abort()
  }, [key])
  return state
}

export class PluginHooksModel {
  static readonly provide = providePlugin
  static readonly usePlugin = usePlugin
  static readonly useSubscribable = useSubscribable
  static readonly useContract = useContract
  static readonly useRegistry = useRegistry
  static readonly useContributionFailures = useContributionFailures
  static readonly useKeyed = useKeyed
  static readonly useLatest = useLatest
}
