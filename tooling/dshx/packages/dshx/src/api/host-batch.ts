import type { ConnectionFetchRoute, HostConnectionHandle } from '@deepseek-ai/dsh-client-connection'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import type { ApiRegistry, RegisteredApi } from './registry.js'
import { ApiBatchProtocol } from './batch-protocol.js'
import { ApiChannelModel } from './channel.js'
import { TracerModel } from '../tracing/tracer.js'
import { TraceparentModel } from '../tracing/traceparent.js'

const decodeRequest = Schema.decodeUnknownOption(ApiBatchProtocol.request)

const apiAt = (registry: ApiRegistry, channel: string): RegisteredApi | undefined => {
  for (const api of registry.apis.values()) if (ApiChannelModel.apiChannel(api.owner, api.id).slice(1) === channel) return api
  return undefined
}

const HANDLER_FAILED = { ok: false, error: { code: 'internal', message: 'API handler failed. See Host diagnostics.', details: {} } } as const

/**
 * The batched-read route the leading Host serves. Each entry runs through its API's own dispatch, exactly as its
 * per-channel route would (validation, caller, one `api-dispatch` span), all entries at once; the answer streams one
 * NDJSON line per entry as it settles, so one slow or failing call never holds or fails the others.
 */
const batchRoute = (registry: ApiRegistry, connection: HostConnectionHandle): ConnectionFetchRoute => ({
  path: ApiChannelModel.batchPath,
  methods: ['POST'],
  requestBody: 'buffered',
  fetch: async request => {
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return new Response('content type must be application/json', { status: 415 })
    }
    let body: unknown
    try {
      body = await request.json()
    } catch {
      return new Response('body is not JSON', { status: 400 })
    }
    const parsed = decodeRequest(body)
    if (Option.isNone(parsed)) return new Response('invalid batch request', { status: 400 })
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start: controller => {
        let open = true
        let pending = parsed.value.entries.length
        const write = (line: Parameters<typeof ApiBatchProtocol.encodeLine>[0]): void => {
          if (!open) return
          controller.enqueue(encoder.encode(ApiBatchProtocol.encodeLine(line)))
          pending -= 1
          if (pending > 0) return
          open = false
          controller.close()
        }
        if (pending === 0) {
          open = false
          controller.close()
          return
        }
        request.signal.addEventListener(
          'abort',
          () => {
            if (!open) return
            open = false
            controller.close()
          },
          { once: true },
        )
        for (const entry of parsed.value.entries) {
          const separator = entry.endpoint.indexOf('/')
          const api = separator === -1 ? undefined : apiAt(registry, entry.endpoint.slice(0, separator))
          if (api === undefined) {
            write({ id: entry.id, status: 404 })
            continue
          }
          const method = entry.endpoint.slice(separator + 1)
          // A browser caller cannot set headers per entry, so each entry's trace context rides in its envelope.
          const parent = TraceparentModel.fromEnvelope(entry.payload)
          TracerModel.process()
            .runWithParent(parent, () => api.dispatch(method, entry.payload, request.signal, { kind: 'client' }, connection.browserPeer))
            .then(
              result => write({ id: entry.id, result }),
              () => write({ id: entry.id, result: HANDLER_FAILED }),
            )
        }
      },
    })
    return new Response(stream, { headers: { 'content-type': ApiBatchProtocol.contentType, 'cache-control': 'no-cache' } })
  },
})

export class HostApiBatchModel {
  static readonly route = batchRoute
}
