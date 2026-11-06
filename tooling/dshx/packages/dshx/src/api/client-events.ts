import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiClient, ApiEventClientPayload, ApiEventStatus } from './types.js'
import { ApiProtocolModel } from './common.js'
import { ApiRuntimeModel } from './runtime.js'
import { ApiChannelModel } from './channel.js'
import { decodeJson, jsonValueSchema } from '../json.js'

interface EventSourceLike {
  readonly readyState: number
  onmessage: ((event: { readonly data: string }) => void) | null
  onerror: (() => void) | null
  close(): void
}

type EventSourceConstructor = new (url: string) => EventSourceLike

const EVENT_SOURCE_CLOSED = 2

interface Subscriber {
  readonly key: string
  readonly deliver: (frame: EventFrame) => void
  readonly statusChanged: () => void
}

/**
 * One page-wide stream, in exactly one phase: `closed` between the last and the next subscriber, `connecting` while
 * the Host has not listed its events yet (a reconnecting source included), `live` once it did, and `missing` when no
 * stream exists (an older dshx leads, or this page has no EventSource).
 */
type HubState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'missing' }
  | { readonly kind: 'connecting'; readonly source: EventSourceLike }
  | { readonly kind: 'live'; readonly source: EventSourceLike; readonly catalog: ReadonlySet<string> }

interface EventHub {
  state: HubState
  readonly subscribers: Set<Subscriber>
}

const frameSchema = Schema.Union([
  Schema.Struct({ type: Schema.Literal('catalog'), events: Schema.Array(Schema.String) }),
  Schema.Struct({ type: Schema.Literal('event'), key: Schema.String, version: Schema.Number.check(Schema.isFinite()), data: Schema.Unknown }),
])

type EventFrame = Extract<(typeof frameSchema)['Type'], { readonly type: 'event' }>

// v2: the hub keeps a phase union; a bundle still on v1 has its own stream rather than misreading this one.
const HUB_KEY = Symbol.for('@dshfiles/dshx.api-events.v2')

/** Every plugin bundles its own dshx copy, so the page keeps one stream for all of them. */
const eventHub = (): EventHub => {
  // SAFETY: only this module writes the versioned symbol, and always an EventHub.
  const holder = globalThis as { [HUB_KEY]?: EventHub }
  holder[HUB_KEY] ??= { state: { kind: 'closed' }, subscribers: new Set() }
  return holder[HUB_KEY]
}

const statusOf = (hub: EventHub, key: string): ApiEventStatus => {
  switch (hub.state.kind) {
    case 'missing':
      return 'unavailable'
    case 'live':
      return hub.state.catalog.has(key) ? 'live' : 'unavailable'
    case 'closed':
    case 'connecting':
      return 'connecting'
  }
}

const notifyStatus = (hub: EventHub): void => {
  for (const subscriber of [...hub.subscribers]) subscriber.statusChanged()
}

/** Only the stream that is open now may change the hub: a closed stream's late frame must not revive it. */
const isCurrentSource = (hub: EventHub, source: EventSourceLike): boolean =>
  (hub.state.kind === 'connecting' || hub.state.kind === 'live') && hub.state.source === source

const receive = (hub: EventHub, source: EventSourceLike, raw: string): void => {
  if (!isCurrentSource(hub, source)) return
  let parsed: unknown
  try {
    parsed = decodeJson(jsonValueSchema, raw)
  } catch {
    return
  }
  const frame = Schema.decodeUnknownOption(frameSchema)(parsed)
  if (Option.isNone(frame)) return
  if (frame.value.type === 'catalog') {
    hub.state = { kind: 'live', source, catalog: new Set(frame.value.events) }
    notifyStatus(hub)
    return
  }
  const event = frame.value
  for (const subscriber of [...hub.subscribers]) if (subscriber.key === event.key) subscriber.deliver(event)
}

const open = (hub: EventHub): void => {
  if (hub.state.kind === 'connecting' || hub.state.kind === 'live') return
  // SAFETY: the page's EventSource is read structurally; a carrier without one has no browser event stream.
  const EventSourceClass = (globalThis as { EventSource?: EventSourceConstructor }).EventSource
  if (typeof EventSourceClass !== 'function') {
    hub.state = { kind: 'missing' }
    return
  }
  const source = new EventSourceClass(ApiChannelModel.eventsPath.slice(1))
  hub.state = { kind: 'connecting', source }
  source.onmessage = message => receive(hub, source, message.data)
  source.onerror = () => {
    if (!isCurrentSource(hub, source)) return
    // A closed source got a non-stream answer (a Host whose leader predates events); otherwise it is reconnecting.
    hub.state = source.readyState === EVENT_SOURCE_CLOSED ? { kind: 'missing' } : { kind: 'connecting', source }
    notifyStatus(hub)
  }
}

const close = (hub: EventHub): void => {
  const current = hub.state
  if (current.kind === 'connecting' || current.kind === 'live') current.source.close()
  hub.state = { kind: 'closed' }
}

/**
 * Follow one declared event of the API behind `client` (from `useApi` or `createApiClient`). Every payload is
 * checked against the event's schema and contract version before `onEvent` sees it. `onStatus` reports whether the
 * Host publishes the event: keep polling while it is not `live`, and read once more when it becomes `live`, because
 * events sent while the stream was down are not replayed.
 */
const subscribeApiEvent = <
  const Methods extends Record<string, AnyApiMethodDefinition>,
  const Events extends Record<string, AnyApiEventDefinition>,
  K extends keyof Events & string,
>(
  client: ApiClient<Methods, Events>,
  event: K,
  handlers: { readonly onEvent: (payload: ApiEventClientPayload<Events[K]>) => void; readonly onStatus?: (status: ApiEventStatus) => void },
): (() => void) => {
  const target = ApiRuntimeModel.eventTarget(client)
  const definition = target?.contract.events?.[event]
  if (target === undefined || definition === undefined) throw new TypeError(`API client has no event ${JSON.stringify(event)}.`)
  const hub = eventHub()
  const key = ApiChannelModel.eventKey(target.owner, target.contract.id, event)
  let status: ApiEventStatus | undefined
  let active = true
  const subscriber: Subscriber = {
    key,
    deliver: frame => {
      if (frame.version !== target.contract.version) return
      ApiProtocolModel.validate(definition.schema, frame.data).then(
        payload => {
          // SAFETY: the event's own schema produced this value, which is its client payload type.
          const eventPayload = payload as ApiEventClientPayload<Events[K]>
          if (active) handlers.onEvent(eventPayload)
        },
        cause => console.warn(`dshx: dropped ${target.contract.id} event ${event}`, cause),
      )
    },
    statusChanged: () => {
      const next = statusOf(hub, key)
      if (next === status) return
      status = next
      handlers.onStatus?.(next)
    },
  }
  hub.subscribers.add(subscriber)
  open(hub)
  subscriber.statusChanged()
  // A Host restart may bring a leader that serves events; try again once its connection is back.
  const unsubscribeConnection = ApiRuntimeModel.subscribeConnection(client, () => {
    if (hub.state.kind !== 'missing' || !ApiRuntimeModel.connectionAvailable(client)) return
    open(hub)
    notifyStatus(hub)
  })
  return () => {
    if (!active) return
    active = false
    unsubscribeConnection()
    hub.subscribers.delete(subscriber)
    if (hub.subscribers.size === 0) close(hub)
  }
}

export class ApiClientEventsModel {
  static readonly subscribe = subscribeApiEvent
}
