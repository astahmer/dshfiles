import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { HopRequest } from '../src/network.js'

/** A loopback origin: `/moved` redirects, `/slow` sends one chunk and then stalls, anything else answers text. */
const origin = Effect.acquireRelease(
  Effect.callback<{ readonly server: Server; readonly port: number; readonly seen: IncomingHttpHeaders[] }>(resume => {
    const seen: IncomingHttpHeaders[] = []
    const server = createServer((request, response) => {
      seen.push(request.headers)
      if (request.url === '/moved') {
        response.writeHead(301, { location: '/target' })
        response.end()
        return
      }
      if (request.url === '/slow') {
        response.writeHead(200, { 'content-type': 'text/plain' })
        response.write('first chunk')
        return
      }
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end(`hello from ${request.headers.host ?? ''}`)
    })
    server.listen(0, '127.0.0.1', () => {
      // SAFETY: a server listening on a TCP port reports an AddressInfo, never a pipe name.
      const { port } = server.address() as AddressInfo
      resume(Effect.succeed({ server, port, seen }))
    })
  }),
  ({ server }) =>
    Effect.callback<void>(resume => {
      server.closeAllConnections()
      server.close(() => resume(Effect.void))
    }),
)

const loopback = [{ address: '127.0.0.1', family: 4 as const }]

describe('HopRequest.pinned', () => {
  it.effect('connects to the pinned address, leaves redirects to the provider and sends no trace headers', () =>
    Effect.gen(function* () {
      const { port, seen } = yield* origin
      const signal = new AbortController().signal
      const moved = yield* HopRequest.pinned(new URL(`http://pinned.invalid:${String(port)}/moved`), loopback, { accept: 'text/plain' }, signal)
      expect(moved.response.status).toBe(301)
      expect(moved.response.headers.get('location')).toBe('/target')
      yield* Effect.promise(() => moved.close())

      const hop = yield* HopRequest.pinned(new URL(`http://pinned.invalid:${String(port)}/target`), loopback, { accept: 'text/plain' }, signal)
      expect(yield* Effect.promise(() => hop.response.text())).toBe(`hello from pinned.invalid:${String(port)}`)
      yield* Effect.promise(() => hop.close())

      expect(seen.map(headers => headers.accept)).toEqual(['text/plain', 'text/plain'])
      expect(seen.some(headers => headers.traceparent !== undefined || headers.b3 !== undefined)).toBe(false)
    }).pipe(Effect.scoped),
  )

  it.effect("stops reading the body when the provider's signal aborts after the headers arrived", () =>
    Effect.gen(function* () {
      const { port } = yield* origin
      const controller = new AbortController()
      const hop = yield* HopRequest.pinned(new URL(`http://pinned.invalid:${String(port)}/slow`), loopback, {}, controller.signal)
      const reader = hop.response.body?.getReader()
      expect(reader).toBeDefined()
      const first = yield* Effect.promise(() => reader?.read() ?? Promise.resolve(undefined))
      expect(first?.done).toBe(false)
      controller.abort(new Error('deadline'))
      const next = yield* Effect.promise(() =>
        (reader?.read() ?? Promise.resolve(undefined)).then(
          () => 'read',
          () => 'aborted',
        ),
      )
      expect(next).toBe('aborted')
      yield* Effect.promise(() => hop.close())
    }).pipe(Effect.scoped),
  )

  it.effect('fails with the transport error and closes its Agent when nothing listens', () =>
    Effect.gen(function* () {
      const { port, server } = yield* origin
      yield* Effect.callback<void>(resume => {
        server.close(() => resume(Effect.void))
      })
      const error = yield* HopRequest.pinned(new URL(`http://pinned.invalid:${String(port)}/`), loopback, {}, new AbortController().signal).pipe(Effect.flip)
      expect(String(error)).toMatch(/fetch failed/u)
    }).pipe(Effect.scoped),
  )
})
