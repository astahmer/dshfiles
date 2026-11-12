import type { IncomingMessage, ServerResponse } from 'node:http'
import { Effect, Exit, Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import { holdRoute, register, type RouteHandler, type RouteServer } from '../src/effect/web-routes.js'

/** The DSH web server's registration rule: one owner per (kind, path), a second one throws. */
const fakeServer = () => {
  const routes = new Map<string, RouteHandler>()
  const server: RouteServer = {
    register: route => {
      const key = `${route.kind} ${route.path}`
      if (routes.has(key)) throw new Error(`webserver: duplicate ${route.kind} route "${route.path}"`)
      routes.set(key, route.handler)
      return () => routes.delete(key)
    },
  }
  const call = async (key: string): Promise<{ status: number; body: string }> => {
    const handler = routes.get(key)
    if (handler === undefined) return { status: 404, body: '' }
    let status = 200
    let body = ''
    const response = {
      writeHead: (code: number) => {
        status = code
        return response
      },
      end: (text?: string) => {
        body = text ?? ''
        return response
      },
    }
    // SAFETY: the handlers under test only call writeHead and end, which this stand-in implements.
    await handler({} as IncomingMessage, response as unknown as ServerResponse)
    return { status, body }
  }
  return { server, routes, call }
}

const answering =
  (text: string): RouteHandler =>
  (_request, response) => {
    response.writeHead(200)
    response.end(text)
  }

describe('WebRoutes', () => {
  it('lets a reloaded plugin take its route over while the old instance still holds it', async () => {
    const { server, routes, call } = fakeServer()
    const releaseOld = holdRoute(server, { kind: 'exact', path: '/api/x/ingest', handler: answering('old') })
    // The rebuilt instance activates before the old Scope closes: no duplicate, and it answers at once.
    const releaseNew = holdRoute(server, { kind: 'exact', path: '/api/x/ingest', handler: answering('new') })
    expect(await call('exact /api/x/ingest')).toEqual({ status: 200, body: 'new' })
    releaseOld()
    expect(await call('exact /api/x/ingest')).toEqual({ status: 200, body: 'new' })
    releaseNew()
    expect(routes.size).toBe(0)
  })

  it('removes the route with its only holder, so the plugin can register it again', () => {
    const { server, routes } = fakeServer()
    const release = holdRoute(server, { kind: 'prefix', path: '/p', handler: answering('a') })
    expect(routes.size).toBe(1)
    release()
    release()
    expect(routes.size).toBe(0)
    holdRoute(server, { kind: 'prefix', path: '/p', handler: answering('b') })()
    expect(routes.size).toBe(0)
  })

  it('keeps refusing a path another owner registered without the helper', () => {
    const { server } = fakeServer()
    server.register({ kind: 'exact', path: '/taken', handler: answering('them') })
    expect(() => holdRoute(server, { kind: 'exact', path: '/taken', handler: answering('us') })).toThrow(/duplicate exact route/u)
  })

  it('holds the route for the life of a Scope', async () => {
    const { server, routes } = fakeServer()
    const scope = Scope.makeUnsafe()
    await Effect.runPromise(Scope.provide(register(server, { kind: 'exact', path: '/s', handler: answering('s') }), scope))
    expect(routes.size).toBe(1)
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(routes.size).toBe(0)
  })

  it('takes a route over from an older registration made without the helper once it is released', async () => {
    const { server, routes, call } = fakeServer()
    const releaseOld = server.register({ kind: 'exact', path: '/api/x/pair', handler: answering('old') })
    const scope = Scope.makeUnsafe()
    // Activation does not wait for, or fail on, the older registration.
    await Effect.runPromise(Scope.provide(register(server, { kind: 'exact', path: '/api/x/pair', handler: answering('new') }), scope))
    expect(await call('exact /api/x/pair')).toEqual({ status: 200, body: 'old' })
    releaseOld()
    await new Promise(resolve => setTimeout(resolve, 600))
    expect(await call('exact /api/x/pair')).toEqual({ status: 200, body: 'new' })
    await Effect.runPromise(Scope.close(scope, Exit.void))
    expect(routes.size).toBe(0)
  })
})
