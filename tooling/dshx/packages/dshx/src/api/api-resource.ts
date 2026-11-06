import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiCallOptions, ApiClient, ApiClientContract, ApiClientInput, ApiClientOutput } from './types.js'
import { ApiProtocolModel } from './common.js'
import { ApiChannelModel } from './channel.js'
import { ApiRuntimeModel, type ApiConnectionHandle } from './runtime.js'
import { ApiClientEventsModel } from './client-events.js'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { ResourceStoreModel, type ResourceConnection, type ResourceInvalidationSource, type ResourceSnapshot } from './resource-store.js'

/** How one dshx read behaves in the page-wide resource store; every caller of the key should pass the same values. */
export interface ApiResourceOptions<Output> {
  readonly staleTime?: number
  readonly pollInterval?: number
  /** Poll while the API's invalidating events are live; omit to rely on them alone. */
  readonly livePollInterval?: number
  readonly shouldPoll?: (snapshot: ResourceSnapshot<Output>) => boolean
  readonly pollWhileHidden?: boolean
}

const CONNECTION_IDS_KEY = Symbol.for('@dshfiles/dshx.resource-connections.v1')

/** One page-wide number per Connection, so two Connections never share a key. */
const connectionNumber = (identity: ResourceConnection['identity']): number => {
  // SAFETY: only this module writes the versioned symbol, and always this shape.
  const holder = globalThis as { [CONNECTION_IDS_KEY]?: { next: number; readonly ids: WeakMap<ResourceConnection['identity'], number> } }
  holder[CONNECTION_IDS_KEY] ??= { next: 1, ids: new WeakMap() }
  const registry = holder[CONNECTION_IDS_KEY]
  const existing = registry.ids.get(identity)
  if (existing !== undefined) return existing
  const assigned = registry.next
  registry.next += 1
  registry.ids.set(identity, assigned)
  return assigned
}

const ALWAYS_UP = 'up'
const decodeGeneration = Schema.decodeUnknownOption(Schema.Struct({ id: Schema.Number }))

/** The Connection's generation number, `undefined` while it is down; a Connection without generations is always up. */
const generationOf = (source: ApiConnectionHandle['hostDescription']): number | typeof ALWAYS_UP | undefined => {
  if (source?.getSnapshot === undefined) return ALWAYS_UP
  const snapshot = source.getSnapshot()
  if (snapshot === undefined) return undefined
  return Option.match(decodeGeneration(snapshot), { onNone: () => ALWAYS_UP, onSome: generation => generation.id })
}

const resourceConnection = (client: ApiClient): ResourceConnection | undefined => {
  const connection = ApiRuntimeModel.connectionOf(client)
  if (connection === undefined) return undefined
  const source = connection.hostDescription
  return {
    identity: connection.identity,
    generation: () => generationOf(source),
    subscribe: listener => source?.subscribe?.(listener) ?? (() => undefined),
  }
}

/** A tag of one API, as the store sees it: tags of two APIs never collide. */
const scopedTag = (contract: { readonly owner?: string | undefined; readonly id: string }, owner: string, tag: string): string =>
  `${contract.owner ?? owner}/${contract.id}#${tag}`

const invalidationSources = (client: ApiClient, methodTags: readonly string[], connectionId: number): ResourceInvalidationSource[] => {
  const target = ApiRuntimeModel.eventTarget(client)
  if (target === undefined || methodTags.length === 0) return []
  const events: Record<string, AnyApiEventDefinition> = target.contract.events ?? {}
  return Object.entries(events)
    .filter(([, definition]) => definition.invalidates?.some(tag => methodTags.includes(tag)) === true)
    .map(([name, definition]) => ({
      id: `${ApiChannelModel.eventKey(target.owner, target.contract.id, name)}@${connectionId}`,
      tags: (definition.invalidates ?? []).map(tag => scopedTag(target.contract, target.owner, tag)),
      subscribe: handlers =>
        ApiClientEventsModel.subscribe(client, name, {
          onEvent: () => handlers.onInvalidate(),
          onStatus: status => handlers.onLive(status === 'live'),
        }),
    }))
}

interface ResourceMethod<M> {
  call(input: ApiClientInput<M> | undefined, options: ApiCallOptions): Promise<ApiClientOutput<M>>
}

/**
 * Register one read of a dshx API in the page-wide resource store and return its key. The key names the owner, API,
 * version, method, input and Connection; the method's `tags` and its API's invalidating events come from the contract.
 */
const apiResource = <const Methods extends Record<string, AnyApiMethodDefinition>, K extends keyof Methods & string>(input: {
  readonly client: ApiClient<Methods>
  readonly method: K
  readonly input?: ApiClientInput<Methods[K]>
  readonly options?: ApiResourceOptions<ApiClientOutput<Methods[K]>>
}): string => {
  const target = ApiRuntimeModel.eventTarget(input.client)
  if (target === undefined) throw new TypeError('apiResource needs a client from useApi or createApiClient.')
  const connection = resourceConnection(input.client)
  const connectionId = connection === undefined ? 0 : connectionNumber(connection.identity)
  const definition = target.contract.methods[input.method]
  const tags = (definition?.tags ?? []).map(tag => scopedTag(target.contract, target.owner, tag))
  const key = [target.owner, target.contract.id, target.contract.version, input.method, ApiProtocolModel.stableJson(input.input), connectionId].join('\u0000')
  const method: ResourceMethod<Methods[K]> = { call: input.client[input.method] }
  const options = input.options ?? {}
  return ResourceStoreModel.page().register<ApiClientOutput<Methods[K]>>({
    key,
    fetch: signal => method.call(input.input, { signal }),
    tags,
    invalidatedBy: invalidationSources(input.client, definition?.tags ?? [], connectionId),
    ...(connection !== undefined && { connection }),
    ...(options.staleTime !== undefined && { staleTime: options.staleTime }),
    ...(options.pollInterval !== undefined && { pollInterval: options.pollInterval }),
    ...(options.livePollInterval !== undefined && { livePollInterval: options.livePollInterval }),
    ...(options.shouldPoll !== undefined && { shouldPoll: options.shouldPoll }),
    ...(options.pollWhileHidden !== undefined && { pollWhileHidden: options.pollWhileHidden }),
  })
}

/** Re-read every subscribed resource of `contract` whose method carries one of `tags`, such as after a write. */
const invalidateApiResources = (input: { readonly contract: ApiClientContract; readonly tags: readonly string[]; readonly owner?: string }): void => {
  ResourceStoreModel.page().invalidate({ tags: input.tags.map(tag => scopedTag(input.contract, input.owner ?? 'plugin', tag)) })
}

export class ApiResourceModel {
  static readonly register = apiResource
  static readonly invalidate = invalidateApiResources
}
