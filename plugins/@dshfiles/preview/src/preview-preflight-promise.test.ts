import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterAll, beforeAll, describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { embedVerdict } from './embed-policy.js'
import { PreviewPreflight } from './preview-preflight-promise.js'

const listen = (handler: (request: IncomingMessage, response: ServerResponse) => void) =>
  new Promise<{ readonly server: Server; readonly origin: string }>((resolve, reject) => {
    const server = createServer(handler)
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        reject(new Error('the fixture server did not get a port'))
        return
      }
      resolve({ server, origin: `http://127.0.0.1:${String(address.port)}` })
    })
  })

const close = (server: Server) => new Promise<void>(resolve => server.close(() => resolve()))

let framingDenied: { readonly server: Server; readonly origin: string }
let plain: { readonly server: Server; readonly origin: string }
let stoppedOrigin: string

const probe = (url: string) =>
  Effect.gen(function* () {
    const preflight = yield* PreviewPreflight
    return yield* preflight.probe({ url })
  }).pipe(Effect.provide(PreviewPreflight.layer))

describe('PreviewPreflight', () => {
  it.effect('reports a framing refusal with the header that made it, and a plain page as open', () =>
    Effect.gen(function* () {
      const denied = yield* probe(`${framingDenied.origin}/`)
      expect(denied).toMatchObject({ reachable: true, status: 200, framing: 'denied', detail: 'X-Frame-Options: deny' })
      expect(embedVerdict(denied)).toBe('refused')

      const open = yield* probe(`${plain.origin}/`)
      expect(open).toMatchObject({ reachable: true, status: 200, framing: 'allowed', detail: null })
      expect(embedVerdict(open)).toBe('open')
    }),
  )

  it.effect('reports a stopped port as unreachable instead of failing', () =>
    Effect.gen(function* () {
      const check = yield* probe(`${stoppedOrigin}/`)
      expect(check).toMatchObject({ reachable: false, status: null, framing: 'allowed' })
      expect(embedVerdict(check)).toBe('unreachable')
    }),
  )

  it.effect('refuses to request anything but an http(s) address', () =>
    Effect.gen(function* () {
      const check = yield* probe('file:///etc/passwd')
      expect(check).toMatchObject({ reachable: false, framing: 'allowed', detail: 'Not an http(s) address.' })
      expect(embedVerdict(check)).toBe('unreachable')
    }),
  )

  it.effect('records one preview preflight span per check', () => {
    const recorder = recordSpans()
    return Effect.gen(function* () {
      yield* probe(`${plain.origin}/`)
      expect(recorder.named('preview preflight')).toHaveLength(1)
    }).pipe(Effect.provide(DshxEffect.tracerLayer), Effect.ensuring(Effect.sync(() => recorder.stop())))
  })
})

// Servers are shared by the cases and closed afterwards; the third case targets a port nothing listens on any more.
const started: Server[] = []
beforeAll(async () => {
  framingDenied = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html', 'x-frame-options': 'deny' })
    response.end('<h1>denied</h1>')
  })
  plain = await listen((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html' })
    response.end('<h1>plain</h1>')
  })
  started.push(framingDenied.server, plain.server)
  const temporary = await listen((_request, response) => {
    response.end('gone')
  })
  stoppedOrigin = temporary.origin
  await close(temporary.server)
})

afterAll(async () => {
  await Promise.all(started.map(close))
})
