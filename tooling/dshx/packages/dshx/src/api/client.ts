import type { ReactNode } from 'react'
import type {
  AnyApiEventDefinition,
  AnyApiMethodDefinition,
  ApiClientContract,
  ApiCallOptions,
  ApiClient,
  ApiClientInput,
  ApiClientOutput,
  ApiContract,
  ApiError,
  ApiEventClientPayload,
  ApiEventStatus,
  ApiFetchStatus,
  ApiQueryOptions,
  ApiQueryResult,
} from './types.js'
import { ApiProtocolModel } from './common.js'
import { ApiRuntimeModel, type ContextLike } from './runtime.js'
import { ApiClientEventsModel } from './client-events.js'
import { ApiResourceModel, type ApiResourceOptions } from './api-resource.js'
import { ResourceStoreModel, type ResourceSnapshot, type ResourceSubscription } from './resource-store.js'

type ReactRuntime = typeof import('react')
declare const require: ((name: string) => ReactRuntime) | undefined
let react: ReactRuntime | undefined
let apiContext: import('react').Context<ApiClientRuntime | undefined> | undefined

export interface ApiClientRuntime {
  client<
    const Methods extends Record<string, AnyApiMethodDefinition>,
    const Events extends Record<string, AnyApiEventDefinition> = Record<string, AnyApiEventDefinition>,
  >(
    contract: ApiClientContract<Methods, Events>,
  ): ApiClient<Methods, Events>
}

export const createApiClient = ApiRuntimeModel.createClient

function runtime(): ReactRuntime {
  if (react !== undefined) return react
  // SAFETY: a bundler may expose the CommonJS loader on the global object; it loads the React runtime here.
  const loader = typeof require === 'function' ? require : (globalThis as { require?: (name: string) => ReactRuntime }).require
  if (typeof loader !== 'function') throw new Error('React runtime is unavailable for API hooks.')
  react = loader('react')
  return react
}

function context(): import('react').Context<ApiClientRuntime | undefined> {
  if (apiContext !== undefined) return apiContext
  apiContext = runtime().createContext<ApiClientRuntime | undefined>(undefined)
  return apiContext
}

/** One lazy contract-identity map for the lifetime of a Client Fiber. */
const createApiClientRuntime = (ctx: ContextLike, packageId: string): ApiClientRuntime => {
  const clients = new Map<object, ApiClient>()
  return {
    client<
      const Methods extends Record<string, AnyApiMethodDefinition>,
      const Events extends Record<string, AnyApiEventDefinition> = Record<string, AnyApiEventDefinition>,
    >(contract: ApiClientContract<Methods, Events>): ApiClient<Methods, Events> {
      const existing = clients.get(contract)
      if (existing !== undefined) {
        // SAFETY: the map is keyed by contract identity, so a cached client was created for this exact contract.
        return existing as ApiClient<Methods, Events>
      }
      const created = ApiRuntimeModel.createClient(ctx, contract, packageId)
      clients.set(contract, created)
      return created
    },
  }
}

const provideApiContext = (component: (props: any) => ReactNode, client: ApiClientRuntime): ((props: any) => ReactNode) => {
  return (props: any) => runtime().createElement(context().Provider, { value: client }, runtime().createElement(component, props))
}

export function useApi<
  const Methods extends Record<string, AnyApiMethodDefinition>,
  const Events extends Record<string, AnyApiEventDefinition> = Record<string, AnyApiEventDefinition>,
>(contract: ApiClientContract<Methods, Events>): ApiClient<Methods, Events> {
  const client = runtime().useContext(context())
  if (client !== undefined) return client.client(contract)
  throw new Error(`API ${JSON.stringify(contract.id)} is unavailable outside a DSHX Client Slot component.`)
}

/**
 * Follow one event the API's Host publishes; returns whether it is `live`. Keep a polling fallback for any other
 * status, and read once more when it turns `live`: events missed while disconnected are not replayed.
 */
export function useApiEvent<
  const Methods extends Record<string, AnyApiMethodDefinition>,
  const Events extends Record<string, AnyApiEventDefinition>,
  K extends keyof Events & string,
>(contract: ApiClientContract<Methods, Events>, event: K, listener: (payload: ApiEventClientPayload<Events[K]>) => void): ApiEventStatus {
  const api = useApi(contract)
  const [status, setStatus] = runtime().useState<ApiEventStatus>('connecting')
  const latest = runtime().useRef(listener)
  runtime().useEffect(() => {
    latest.current = listener
  })
  runtime().useEffect(() => ApiClientEventsModel.subscribe(api, event, { onEvent: payload => latest.current(payload), onStatus: setStatus }), [api, event])
  return status
}

interface ApiQueryEffectOptions<T> {
  readonly available: () => boolean
  readonly subscribe: (listener: () => void) => () => void
  readonly invoke: (signal: AbortSignal) => Promise<T>
  readonly signal?: AbortSignal
  readonly onPending: (fetchStatus: ApiFetchStatus) => void
  readonly onSuccess: (value: T) => void
  readonly onError: (error: ApiError) => void
  readonly onReconnect: () => void
}

/** Query lifecycle seam kept React-free for generation-loss tests. */
const startApiQueryEffect = <T>(options: ApiQueryEffectOptions<T>): (() => void) => {
  const controller = new AbortController()
  let disposed = false
  let disconnected = !options.available()
  let callerAborted = options.signal?.aborted === true
  const abortFromCaller = (): void => {
    callerAborted = true
    controller.abort(options.signal?.reason)
  }
  if (callerAborted) abortFromCaller()
  else options.signal?.addEventListener('abort', abortFromCaller, { once: true })

  options.onPending(disconnected ? 'paused' : 'fetching')
  const unsubscribe = options.subscribe(() => {
    if (disposed) return
    const available = options.available()
    if (!available && !disconnected) {
      disconnected = true
      controller.abort()
      options.onPending('paused')
    } else if (available && disconnected) {
      disconnected = false
      options.onReconnect()
    }
  })

  const availableAfterSubscribe = options.available()
  if (availableAfterSubscribe === disconnected) options.onPending(availableAfterSubscribe ? 'fetching' : 'paused')
  disconnected = !availableAfterSubscribe
  if (!disconnected) {
    void options.invoke(controller.signal).then(
      value => {
        if (!disposed && !controller.signal.aborted) options.onSuccess(value)
      },
      cause => {
        if (!disposed && !disconnected && (callerAborted || !controller.signal.aborted) && ApiProtocolModel.isApiError(cause)) options.onError(cause)
      },
    )
  }

  return () => {
    disposed = true
    controller.abort()
    options.signal?.removeEventListener('abort', abortFromCaller)
    unsubscribe()
  }
}

// Every runtime client method accepts an optional input; the method form relates both input shapes of ApiMethodClient.
interface ApiQueryMethod<M> {
  call(input: ApiClientInput<M> | undefined, options: ApiCallOptions): Promise<ApiClientOutput<M>>
}

type InternalQueryState<T> =
  | { readonly status: 'pending'; readonly fetchStatus: ApiFetchStatus; readonly data: undefined; readonly error: null }
  | { readonly status: 'success'; readonly fetchStatus: ApiFetchStatus; readonly data: T; readonly error: null }
  | { readonly status: 'error'; readonly fetchStatus: 'idle'; readonly data: T | undefined; readonly error: ApiError }

/** One requested read: `manual` rides with the id it was asked under, so a reconnect resumes it and a settle ends it. */
interface ApiQueryRequest {
  readonly id: number
  readonly manual: boolean
}

export function useApiQuery<const Methods extends Record<string, AnyApiMethodDefinition>, K extends keyof Methods & string>(
  contract: ApiContract<Methods>,
  method: K,
  ...args: ApiClientInput<Methods[K]> extends void ? [options?: ApiQueryOptions<Methods[K]>] : [options: ApiQueryOptions<Methods[K]>]
): ApiQueryResult<ApiClientOutput<Methods[K]>> {
  // SAFETY: the rest tuple above is either [options?] or [options], so index 0 holds that option.
  const options = args[0] as ApiQueryOptions<Methods[K]> | undefined
  const input = options !== undefined && 'input' in options ? options.input : undefined
  const api = useApi(contract)
  const [state, setState] = runtime().useState<InternalQueryState<ApiClientOutput<Methods[K]>>>({
    status: 'pending',
    fetchStatus: options?.enabled === false ? 'idle' : 'fetching',
    data: undefined,
    error: null,
  })
  const fingerprint = runtime().useMemo(() => ApiProtocolModel.stableJson(input), [input])
  const [request, setRequest] = runtime().useState<ApiQueryRequest>({ id: 0, manual: false })
  const requestId = request.id
  const settleRequest = runtime().useCallback(() => {
    setRequest(current => (current.manual ? { ...current, manual: false } : current))
  }, [])

  runtime().useEffect(() => {
    const manuallyRequested = request.manual
    if (options?.enabled === false && !manuallyRequested) {
      setState(previous =>
        previous.status === 'success' ? { ...previous, fetchStatus: 'idle' } : { status: 'pending', fetchStatus: 'idle', data: undefined, error: null },
      )
      return undefined
    }
    return ApiClientLifecycle.startQuery<ApiClientOutput<Methods[K]>>({
      available: () => ApiRuntimeModel.connectionAvailable(api),
      subscribe: listener => ApiRuntimeModel.subscribeConnection(api, listener),
      ...(options?.signal !== undefined && { signal: options.signal }),
      onPending: fetchStatus =>
        setState(previous => {
          if (previous.status === 'success') return { status: 'success', fetchStatus, data: previous.data, error: null }
          if (previous.status === 'error' && previous.data !== undefined) {
            return { status: 'success', fetchStatus, data: previous.data, error: null }
          }
          return { status: 'pending', fetchStatus, data: undefined, error: null }
        }),
      onSuccess: data => {
        settleRequest()
        setState({ status: 'success', fetchStatus: 'idle', data, error: null })
      },
      onError: error => {
        settleRequest()
        setState(previous => ({ status: 'error', fetchStatus: 'idle', data: previous.data, error }))
      },
      // A reconnect keeps asking while a manual read is unanswered, `enabled: false` included.
      onReconnect: () => setRequest(current => ({ id: current.id + 1, manual: current.manual })),
      invoke: signal => {
        const query: ApiQueryMethod<Methods[K]> = { call: api[method] }
        return query.call(input, { signal })
      },
    })
    // `manual` belongs to the id it was requested under: settling it must record the read, not start another.
  }, [api, method, fingerprint, requestId, options?.enabled, options?.signal, settleRequest])

  const refetch = runtime().useCallback(() => {
    setRequest(current => ({ id: current.id + 1, manual: true }))
  }, [])
  return { ...state, refetch }
}

export type UseResourceOptions<Output> = ApiResourceOptions<Output> & {
  /** False keeps the cached data without subscribing, so the key neither reads nor polls for this caller. */
  readonly enabled?: boolean | undefined
  /** Whether this caller is on screen; a hidden caller never starts a read and pauses the poll it alone keeps. */
  readonly visible?: boolean | undefined
  /** A shorter poll only this caller needs while it shows more, such as an open popover. */
  readonly subscriberPollInterval?: number | undefined
}

export type UseResourceResult<T> = ResourceSnapshot<T> & { readonly refetch: () => void }

/**
 * Read one dshx API method through the page-wide resource store: every caller of the same method and input, in any
 * plugin bundle, shares one read, one cache entry and one poll.
 */
export function useResource<const Methods extends Record<string, AnyApiMethodDefinition>, K extends keyof Methods & string>(
  contract: ApiContract<Methods>,
  method: K,
  input: ApiClientInput<Methods[K]>,
  options: UseResourceOptions<ApiClientOutput<Methods[K]>> = {},
): UseResourceResult<ApiClientOutput<Methods[K]>> {
  const api = useApi(contract)
  const store = ResourceStoreModel.page()
  const key = ApiResourceModel.register({
    client: api,
    method,
    input,
    options: {
      ...(options.staleTime !== undefined && { staleTime: options.staleTime }),
      ...(options.pollInterval !== undefined && { pollInterval: options.pollInterval }),
      ...(options.livePollInterval !== undefined && { livePollInterval: options.livePollInterval }),
      ...(options.shouldPoll !== undefined && { shouldPoll: options.shouldPoll }),
      ...(options.pollWhileHidden !== undefined && { pollWhileHidden: options.pollWhileHidden }),
    },
  })
  const enabled = options.enabled !== false
  const visible = options.visible !== false
  const subscriberPollInterval = options.subscriberPollInterval
  const subscriberOptions = runtime().useRef({ visible, pollInterval: subscriberPollInterval })
  subscriberOptions.current = { visible, pollInterval: subscriberPollInterval }
  const subscription = runtime().useRef<ResourceSubscription | undefined>(undefined)
  const subscribe = runtime().useCallback(
    (listener: () => void) => {
      if (!enabled) return () => undefined
      const created = store.subscribe(key, listener, subscriberOptions.current)
      subscription.current = created
      return () => {
        created()
        if (subscription.current === created) subscription.current = undefined
      }
    },
    [store, key, enabled],
  )
  runtime().useEffect(() => {
    subscription.current?.update({ visible, pollInterval: subscriberPollInterval })
  }, [visible, subscriberPollInterval])
  const snapshot = runtime().useSyncExternalStore(subscribe, () => store.getSnapshot<ApiClientOutput<Methods[K]>>(key))
  const refetch = runtime().useCallback(() => {
    store.ensure(key, { force: true }).catch(() => undefined)
  }, [store, key])
  return runtime().useMemo(() => ({ ...snapshot, refetch }), [snapshot, refetch])
}

export class ApiClientLifecycle {
  static readonly create = createApiClientRuntime
  static readonly provide = provideApiContext
  static readonly startQuery = startApiQueryEffect
}
