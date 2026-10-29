import { z } from 'zod/mini'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiClient, ApiEventClientPayload, ApiEventStatus } from './types.js'
import { ApiProtocolModel } from './common.js'
import { ApiRuntimeModel } from './runtime.js'

interface EventSourceLike {
  readonly readyState: number
  onmessage: ((event: { readonly data: unknown }) => void) | null
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

/** One page-wide stream: `missing` once the Host answered without one (an older dshx leads, or no EventSource here). */
interface EventHub {
  source: EventSourceLike | undefined
  missing: boolean
  catalog: ReadonlySet<string> | undefined
  readonly subscribers: Set<Subscriber>
}

const frameSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('catalog'), events: z.array(z.string()) }),
  z.object({ type: z.literal('event'), key: z.string(), version: z.number(), data: z.unknown() }),
])

type EventFrame = Extract<z.infer<typeof frameSchema>, { readonly type: 'event' }>

const HUB_KEY = Symbol.for('@dshfiles/dshx.api-events.v1')

/** Every plugin bundles its own dshx copy, so the page keeps one stream for all of them. */
const eventHub = (): EventHub => {
  // SAFETY: only this module writes the versioned symbol, and always an EventHub.
  const holder = globalThis as { [HUB_KEY]?: EventHub }
  holder[HUB_KEY] ??= { source: undefined, missing: false, catalog: undefined, subscribers: new Set() }
  return holder[HUB_KEY]
}

const statusOf = (hub: EventHub, key: string): ApiEventStatus => {
  if (hub.missing) return 'unavailable'
  if (hub.catalog === undefined) return 'connecting'
  return hub.catalog.has(key) ? 'live' : 'unavailable'
}

const notifyStatus = (hub: EventHub): void => {
  for (const subscriber of [...hub.subscribers]) subscriber.statusChanged()
}

const receive = (hub: EventHub, raw: unknown): void => {
  let parsed: unknown
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : undefined
  } catch {
    return
  }
  const frame = frameSchema.safeParse(parsed)
  if (!frame.success) return
  if (frame.data.type === 'catalog') {
    hub.catalog = new Set(frame.data.events)
    notifyStatus(hub)
    return
  }
  const event = frame.data
  for (const subscriber of [...hub.subscribers]) if (subscriber.key === event.key) subscriber.deliver(event)
}

const open = (hub: EventHub): void => {
  if (hub.source !== undefined) return
  // SAFETY: the page's EventSource is read structurally; a carrier without one has no browser event stream.
  const EventSourceClass = (globalThis as { EventSource?: EventSourceConstructor }).EventSource
  if (typeof EventSourceClass !== 'function') {
    hub.missing = true
    return
  }
  hub.missing = false
  hub.catalog = undefined
  const source = new EventSourceClass(ApiProtocolModel.eventsPath.slice(1))
  hub.source = source
  source.onmessage = message => receive(hub, message.data)
  source.onerror = () => {
    if (hub.source !== source) return
    // A closed source got a non-stream answer (a Host whose leader predates events); otherwise it is reconnecting.
    if (source.readyState === EVENT_SOURCE_CLOSED) {
      hub.source = undefined
      hub.missing = true
    }
    hub.catalog = undefined
    notifyStatus(hub)
  }
}

const close = (hub: EventHub): void => {
  hub.source?.close()
  hub.source = undefined
  hub.catalog = undefined
  hub.missing = false
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
  const key = ApiProtocolModel.eventKey(target.owner, target.contract.id, event)
  let status: ApiEventStatus | undefined
  let active = true
  const subscriber: Subscriber = {
    key,
    deliver: frame => {
      if (frame.version !== target.contract.version) return
      ApiProtocolModel.validate(definition.schema, frame.data).then(
        // SAFETY: the event's own schema produced this value, which is its client payload type.
        payload => {
          if (active) handlers.onEvent(payload as ApiEventClientPayload<Events[K]>)
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
    if (!hub.missing || !ApiRuntimeModel.connectionAvailable(client)) return
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
