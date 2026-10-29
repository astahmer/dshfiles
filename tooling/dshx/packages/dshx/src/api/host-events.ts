import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionFetchRoute } from '@deepseek-ai/dsh-client-connection'
import type { AnyApiEventDefinition, AnyApiMethodDefinition, ApiContract, ApiEventHostPayload } from './types.js'
import { ApiProtocolModel } from './common.js'
import { apiRegistry, type ApiEventStream, type ApiRegistry } from './registry.js'

/** What the browser hub decodes: the events served now, or one published event. */
type EventStreamFrame =
  | { readonly type: 'catalog'; readonly events: readonly string[] }
  | { readonly type: 'event'; readonly key: string; readonly version: number; readonly data: unknown }

const frame = (value: EventStreamFrame): string => `data: ${JSON.stringify(value)}\n\n`

const catalogFrame = (registry: ApiRegistry): string =>
  frame({
    type: 'catalog',
    events: [...registry.apis.values()].flatMap(api => Object.keys(api.events ?? {}).map(event => ApiProtocolModel.eventKey(api.owner, api.id, event))),
  })

const streamsOf = (registry: ApiRegistry): Set<ApiEventStream> => {
  registry.eventStreams ??= new Set()
  return registry.eventStreams
}

/** Tell every open stream which events are published now; called when an API mounts or unmounts. */
const announceCatalog = (registry: ApiRegistry): void => {
  if (registry.eventStreams === undefined || registry.eventStreams.size === 0) return
  const chunk = catalogFrame(registry)
  for (const stream of registry.eventStreams) stream.write(chunk)
}

/**
 * The SSE route the leading Host serves. Every browser keeps one stream for all dshx events; it opens with the
 * catalog of published events, then carries each published event. Unregistering it closes the streams it opened,
 * so browsers reconnect to the next leader.
 */
const eventsRoute = (registry: ApiRegistry): { readonly route: ConnectionFetchRoute; readonly closeStreams: () => void } => {
  const opened = new Set<ApiEventStream>()
  const route: ConnectionFetchRoute = {
    path: ApiProtocolModel.eventsPath,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async request => {
      const encoder = new TextEncoder()
      const body = new ReadableStream<Uint8Array>({
        start: controller => {
          let closed = false
          const stream: ApiEventStream = {
            write: chunk => {
              if (!closed) controller.enqueue(encoder.encode(chunk))
            },
            close: () => {
              if (closed) return
              closed = true
              streamsOf(registry).delete(stream)
              opened.delete(stream)
              controller.close()
            },
          }
          if (request.signal.aborted) {
            controller.close()
            return
          }
          streamsOf(registry).add(stream)
          opened.add(stream)
          request.signal.addEventListener('abort', stream.close, { once: true })
          stream.write(': connected\n\n')
          stream.write(catalogFrame(registry))
        },
      })
      return new Response(body, { headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' } })
    },
  }
  return {
    route,
    closeStreams: () => {
      for (const stream of [...opened]) stream.close()
    },
  }
}

/**
 * Publish one declared event to every connected browser. The payload is validated with the event's schema first; an
 * unknown event or an invalid payload rejects. Nothing is sent, and nothing is kept for later, while no browser
 * listens or the API is not served: a browser that connects later reads the current state instead.
 */
const publishApiEvent = async <const Events extends Record<string, AnyApiEventDefinition>, K extends keyof Events & string>(
  ctx: Context,
  contract: ApiContract<Record<string, AnyApiMethodDefinition>, Events>,
  event: K,
  payload: ApiEventHostPayload<Events[K]>,
): Promise<void> => {
  const definition = contract.events?.[event]
  if (definition === undefined) throw new TypeError(`API ${contract.id} declares no event ${JSON.stringify(event)}.`)
  const data = await ApiProtocolModel.validate(definition.schema, payload)
  ApiProtocolModel.jsonBytes(data)
  const registry = apiRegistry(ctx)
  // The served entry is found by its methods object, so the caller never restates its package id.
  const served = [...registry.apis.values()].find(api => api.id === contract.id && api.methods === contract.methods)
  if (served === undefined || registry.eventStreams === undefined || registry.eventStreams.size === 0) return
  const chunk = frame({ type: 'event', key: ApiProtocolModel.eventKey(served.owner, served.id, event), version: contract.version, data })
  for (const stream of registry.eventStreams) stream.write(chunk)
}

export class HostApiEventsModel {
  static readonly route = eventsRoute
  static readonly announceCatalog = announceCatalog
  static readonly publish = publishApiEvent
}
