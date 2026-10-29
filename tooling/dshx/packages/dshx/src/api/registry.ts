import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionRpcHandler } from '@deepseek-ai/dsh-client-connection'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiCaller } from './types.js'

/** An API request or response payload: opaque JSON until the owner's schemas decode it. */
export type ApiPayload = Parameters<ConnectionRpcHandler>[1]

export type ApiDispatchResult =
  | { readonly ok: true; readonly value: { readonly version: number; readonly output: ApiPayload } }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string; readonly details: object } }

export type ApiDispatch = (
  method: string,
  payload: ApiPayload,
  signal: AbortSignal,
  caller: ApiCaller,
  peer: Parameters<ConnectionRpcHandler>[3] | undefined,
) => Promise<ApiDispatchResult>

/** One served API as every Host plugin of the process sees it. */
export interface RegisteredApi {
  readonly owner: string
  readonly id: string
  readonly version: number
  readonly methods: Readonly<Record<string, AnyApiMethodDefinition>>
  /** Absent when an older dshx served the API. */
  readonly events?: Readonly<Record<string, AnyApiEventDefinition>>
  readonly dispatch: ApiDispatch
}

/** One open browser event stream: `write` sends one SSE chunk, `close` ends the response. */
export interface ApiEventStream {
  readonly write: (chunk: string) => void
  readonly close: () => void
}

export interface RegistryMember {
  readonly ctx: Context
  readonly packageId: string
  stop?: () => Promise<void>
}

/**
 * Every plugin bundles its own copy of dshx, so module state is per plugin.
 * The registry lives on globalThis under a versioned symbol, keyed by the Cordis
 * root, so all copies of one protocol version share it.
 */
export interface ApiRegistry {
  readonly apis: Map<string, RegisteredApi>
  readonly members: RegistryMember[]
  leader: RegistryMember | undefined
  /**
   * Package of each tool definition a dshx Host registered from `defineHost({ tools })`, keyed by the definition so an
   * unloaded tool needs no cleanup; absent when an older dshx created the registry.
   */
  toolOwners?: WeakMap<object, string>
  /** Browser event streams the leading Host serves; absent when an older dshx created the registry. */
  eventStreams?: Set<ApiEventStream>
}

const REGISTRY_KEY = Symbol.for('@dshfiles/dshx.api-registry.v1')

type RegistryStore = WeakMap<object, ApiRegistry>

const store = (): RegistryStore => {
  // SAFETY: only this module writes the versioned symbol, and always a RegistryStore.
  const holder = globalThis as { [REGISTRY_KEY]?: RegistryStore }
  holder[REGISTRY_KEY] ??= new WeakMap()
  return holder[REGISTRY_KEY]
}

export const apiKey = (owner: string, id: string): string => `${owner}\0${id}`

export function apiRegistry(ctx: Context): ApiRegistry {
  const root: object = ctx.root ?? ctx
  const registries = store()
  const existing = registries.get(root)
  if (existing !== undefined) return existing
  const created: ApiRegistry = { apis: new Map(), members: [], leader: undefined }
  registries.set(root, created)
  return created
}
