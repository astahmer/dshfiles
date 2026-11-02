import { mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Exit, Fiber, Layer, Ref, Schema, type Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { FetchHttpClient } from 'effect/http'
import { Connectors } from '../src/connectors/connectors.js'
import { connectGateway, type Gateway } from '../src/connectors/gateway.js'
import { GatewayUnreachable, InvalidResponse } from '../src/errors.js'
import { HostDirectory } from '../src/host-directory.js'
import type { RuntimeIdentity, RuntimeRecord } from '../src/records.js'
import { RuntimePool } from '../src/runtime-pool.js'
import { dataLayer } from './fixtures/data-runtime.js'

// The pool contract, formerly pinned on the Promise gateway pool (gateway-pool.test.ts and its characterization),
// kept as the RuntimePool spec. Leases are Scopes now, so a double release cannot happen; a request that reports a
// broken connection does so as a TransportFailure, which is what retires the connection and retries a read.

const runtimeIds = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002'] as const

const identityOf = (runtimeId: string): RuntimeIdentity => ({
  protocolVersion: 1,
  runtimeId,
  profile: 'pool-test',
  homeLeaf: 'pool-home',
  dshVersion: '0.2.1-rc.2',
  capabilities: ['workspace', 'session', 'agent'],
})

const runtimeRecord = (runtimeId: string, launchUrl = 'http://127.0.0.1:1/?token=pool-token-123456'): RuntimeRecord => ({
  schemaVersion: 2,
  id: runtimeId,
  hostId: 'local',
  name: `runtime ${runtimeId}`,
  locator: { kind: 'local', launchUrl },
  identity: identityOf(runtimeId),
  createdAt: '2026-10-05T00:00:00.000Z',
})

const unused = Effect.die('The pool never calls the gateway itself.')

interface FakeConnection {
  readonly runtimeId: string
  readonly closed: Deferred.Deferred<void>
  readonly disposed: Ref.Ref<number>
}

/** Connectors whose gateways only answer the identity check; every connection is recorded, and may be held open. */
const fakeConnectors = Effect.gen(function* () {
  const opened = yield* Ref.make<readonly FakeConnection[]>([])
  const gate = yield* Ref.make<Deferred.Deferred<void> | undefined>(undefined)
  const failNext = yield* Ref.make(0)
  const connect = (input: { readonly runtime: RuntimeRecord }): Effect.Effect<Gateway, GatewayUnreachable, Scope.Scope> =>
    Effect.gen(function* () {
      const held = yield* Ref.get(gate)
      if (held !== undefined) yield* Deferred.await(held)
      if ((yield* Ref.getAndUpdate(failNext, count => Math.max(0, count - 1))) > 0) return yield* new GatewayUnreachable()
      const connection: FakeConnection = { runtimeId: input.runtime.id, closed: yield* Deferred.make<void>(), disposed: yield* Ref.make(0) }
      yield* Effect.addFinalizer(() => Ref.update(connection.disposed, count => count + 1))
      yield* Ref.update(opened, all => [...all, connection])
      return {
        origin: 'http://127.0.0.1:0',
        launchUrl: 'http://127.0.0.1:0/',
        closed: Deferred.await(connection.closed),
        run: () => unused,
        api: method => (method === 'identity' ? Effect.succeed(identityOf(input.runtime.id)) : unused),
        pluginApi: () => () => unused,
        follow: () => unused,
        stream: () => unused,
      } satisfies Gateway
    })
  return {
    opened,
    failNext,
    hold: Effect.flatMap(Deferred.make<void>(), deferred => Effect.as(Ref.set(gate, deferred), deferred)),
    layer: Layer.succeed(Connectors, Connectors.of({ connect })),
  }
})

const seeded = (runtimes: readonly RuntimeRecord[]) =>
  Effect.gen(function* () {
    const directory = yield* HostDirectory
    yield* directory.upsertHost({
      schemaVersion: 2,
      id: 'local',
      name: 'Local',
      connector: { kind: 'local' },
      hidden: false,
      createdAt: '2026-10-05T00:00:00.000Z',
    })
    yield* Effect.forEach(runtimes, runtime => directory.upsertRuntime(runtime))
  })

const poolWith = (input: { readonly connectors: Layer.Layer<Connectors>; readonly runtimes?: readonly RuntimeRecord[] }) => {
  const data = dataLayer({ DSH_HOME: mkdtempSync(join(tmpdir(), 'multi-host-pool-')) })
  return RuntimePool.layer.pipe(
    Layer.provideMerge(Layer.effectDiscard(seeded(input.runtimes ?? runtimeIds.map(id => runtimeRecord(id))))),
    Layer.provideMerge(input.connectors),
    Layer.provideMerge(data),
  )
}

const settle = Effect.forEach(Array.from({ length: 20 }), () => Effect.yieldNow, { discard: true })

describe('RuntimePool', () => {
  it.effect('concurrent callers arriving while the first connect is in flight share that one connection', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.gen(function* () {
        const pool = yield* RuntimePool
        const gate = yield* fake.hold
        const leases = yield* Effect.forkChild(
          Effect.scoped(Effect.all([pool.acquire(runtimeIds[0]), pool.acquire(runtimeIds[0]), pool.acquire(runtimeIds[0])], { concurrency: 'unbounded' })),
        )
        yield* settle
        yield* Deferred.succeed(gate, undefined)
        const acquired = yield* Fiber.join(leases)
        expect(yield* Ref.get(fake.opened)).toHaveLength(1)
        expect(new Set(acquired.map(lease => lease.generation)).size).toBe(1)
      }).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
    }),
  )

  it.effect('different runtimes get different connections', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.scoped(
        Effect.gen(function* () {
          const pool = yield* RuntimePool
          const first = yield* pool.acquire(runtimeIds[0])
          const second = yield* pool.acquire(runtimeIds[1])
          expect(yield* Ref.get(fake.opened)).toHaveLength(2)
          expect(second.generation).not.toBe(first.generation)
        }),
      ).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
    }),
  )

  it.effect('reuses one connection until it is invalidated or its transport drops, and a stale generation is ignored', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.gen(function* () {
        const pool = yield* RuntimePool
        const first = yield* Effect.scoped(pool.acquire(runtimeIds[0]))
        const second = yield* Effect.scoped(pool.acquire(runtimeIds[0]))
        expect(second.generation).toBe(first.generation)
        expect(yield* Ref.get(fake.opened)).toHaveLength(1)

        yield* pool.invalidate(runtimeIds[0], first.generation)
        const third = yield* Effect.scoped(pool.acquire(runtimeIds[0]))
        expect(yield* Ref.get(fake.opened)).toHaveLength(2)
        expect(third.generation).toBeGreaterThan(first.generation)
        yield* pool.invalidate(runtimeIds[0], first.generation)
        expect(yield* pool.generation(runtimeIds[0])).toBe(third.generation)

        const [, current] = yield* Ref.get(fake.opened)
        yield* Deferred.succeed(current?.closed ?? (yield* Deferred.make<void>()), undefined)
        yield* settle
        expect(yield* pool.generation(runtimeIds[0])).toBeUndefined()
      }).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
    }),
  )

  it.effect('closes an idle connection after five minutes, but not while a lease holds it', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.gen(function* () {
        const pool = yield* RuntimePool
        const held = yield* Deferred.make<void>()
        const holder = yield* Effect.forkChild(
          Effect.scoped(Effect.andThen(pool.acquire(runtimeIds[0]), Effect.andThen(Deferred.succeed(held, undefined), Effect.never))),
        )
        yield* Deferred.await(held)
        yield* TestClock.adjust(Duration.minutes(6))
        yield* settle
        expect(yield* pool.generation(runtimeIds[0])).toBeDefined()
        yield* Fiber.interrupt(holder)
        yield* TestClock.adjust(Duration.minutes(4))
        yield* settle
        expect(yield* pool.generation(runtimeIds[0])).toBeDefined()
        yield* TestClock.adjust(Duration.minutes(1))
        yield* settle
        expect(yield* pool.generation(runtimeIds[0])).toBeUndefined()
        const [connection] = yield* Ref.get(fake.opened)
        expect(yield* Ref.get(connection?.disposed ?? (yield* Ref.make(-1)))).toBe(1)
      }).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
    }),
  )

  it.effect('forgets a failed connect so the next call retries', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.gen(function* () {
        const pool = yield* RuntimePool
        yield* Ref.set(fake.failNext, 1)
        const failed = yield* Effect.exit(Effect.scoped(pool.acquire(runtimeIds[0])))
        expect(Exit.isFailure(failed)).toBe(true)
        yield* Effect.scoped(pool.acquire(runtimeIds[0]))
        expect(yield* Ref.get(fake.opened)).toHaveLength(1)
      }).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
    }),
  )

  it.effect('a read retries exactly once: a second transport failure reaches the caller', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.gen(function* () {
        const pool = yield* RuntimePool
        const attempts = yield* Ref.make(0)
        const error = yield* Effect.flip(
          pool.use(
            runtimeIds[0],
            () =>
              Effect.andThen(
                Ref.update(attempts, count => count + 1),
                Effect.fail(new GatewayUnreachable()),
              ),
            { mutation: false },
          ),
        )
        expect(error._tag).toBe('GatewayUnreachable')
        expect(yield* Ref.get(attempts)).toBe(2)
        expect(yield* Ref.get(fake.opened)).toHaveLength(2)
        expect(yield* pool.generation(runtimeIds[0])).toBeUndefined()
        expect((yield* pool.lastError(runtimeIds[0]))?.code).toBe('gateway-unreachable')
      }).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
    }),
  )

  it.effect('a mutation that hits a transport failure is not retried and retires its connection', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.gen(function* () {
        const pool = yield* RuntimePool
        const attempts = yield* Ref.make(0)
        yield* Effect.flip(
          pool.use(
            runtimeIds[0],
            () =>
              Effect.andThen(
                Ref.update(attempts, count => count + 1),
                Effect.fail(new GatewayUnreachable()),
              ),
            { mutation: true },
          ),
        )
        expect(yield* Ref.get(attempts)).toBe(1)
        const opened = yield* Ref.get(fake.opened)
        expect(opened).toHaveLength(1)
        expect(yield* Ref.get(opened[0]?.disposed ?? (yield* Ref.make(-1)))).toBe(1)
        expect(yield* pool.generation(runtimeIds[0])).toBeUndefined()
      }).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
    }),
  )

  it.effect('a non-transport failure keeps the connection and is never retried', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.gen(function* () {
        const pool = yield* RuntimePool
        const attempts = yield* Ref.make(0)
        const error = yield* Effect.flip(
          pool.use(
            runtimeIds[0],
            () =>
              Effect.andThen(
                Ref.update(attempts, count => count + 1),
                Effect.fail(new InvalidResponse()),
              ),
            { mutation: false },
          ),
        )
        expect(error._tag).toBe('InvalidResponse')
        expect(yield* Ref.get(attempts)).toBe(1)
        expect(yield* pool.generation(runtimeIds[0])).toBeDefined()
        const [connection] = yield* Ref.get(fake.opened)
        expect(yield* Ref.get(connection?.disposed ?? (yield* Ref.make(-1)))).toBe(0)
      }).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
    }),
  )

  it.effect('invalidate(runtimeId) disposes only that runtime; closing the pool disposes every one', () =>
    Effect.gen(function* () {
      const fake = yield* fakeConnectors
      yield* Effect.gen(function* () {
        const pool = yield* RuntimePool
        yield* Effect.scoped(pool.acquire(runtimeIds[0]))
        yield* Effect.scoped(pool.acquire(runtimeIds[1]))
        yield* pool.invalidate(runtimeIds[0])
        expect(yield* pool.generation(runtimeIds[0])).toBeUndefined()
        expect(yield* pool.generation(runtimeIds[1])).toBeDefined()
      }).pipe(Effect.provide(poolWith({ connectors: fake.layer })))
      const opened = yield* Ref.get(fake.opened)
      expect(yield* Effect.forEach(opened, connection => Ref.get(connection.disposed))).toEqual([1, 1])
    }),
  )
})

/** A loopback runtime that speaks the DSH launch handoff and native RPC envelope, and can drop sockets on demand. */
const startRuntimeFixture = Effect.acquireRelease(
  Effect.promise(async () => {
    const calls: string[] = []
    const state = { dropNext: 0 }
    const envelope = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ rpcId: Schema.String })))
    const server: Server = createServer((request, response) => {
      if (request.method === 'GET' && request.url?.startsWith('/?token=')) {
        response.writeHead(303, { location: '/', 'set-cookie': 'dsh-auth-fixture=1; Path=/; HttpOnly' })
        response.end()
        return
      }
      const body: string[] = []
      request.setEncoding('utf8')
      request.on('data', chunk => body.push(chunk))
      request.on('end', () => {
        calls.push(request.url ?? '')
        if (state.dropNext > 0) {
          state.dropNext -= 1
          response.destroy()
          return
        }
        const rpcId = envelope(body.join('')).rpcId
        const value = request.url === '/api/session/create' ? { sessionId: 'session-1' } : { items: [] }
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ type: 'server-response', rpcId, result: { ok: true, value } }))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = Schema.decodeUnknownSync(Schema.Struct({ port: Schema.Number }))(server.address()).port
    return { calls, state, server, launchUrl: `http://127.0.0.1:${port}/?token=fixture-token-12345678` }
  }),
  fixture => Effect.promise(() => new Promise<void>(resolve => fixture.server.close(() => resolve()))),
)

describe('RuntimePool against a loopback runtime', () => {
  it.live('a read whose connection drops retries once on a fresh connection', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* startRuntimeFixture
        const connections = yield* Ref.make(0)
        const record = runtimeRecord(runtimeIds[0], fixture.launchUrl)
        const fake = Layer.effect(
          Connectors,
          Effect.succeed(
            Connectors.of({
              connect: () =>
                Effect.andThen(
                  Ref.update(connections, count => count + 1),
                  Effect.map(
                    connectGateway({ launchUrl: fixture.launchUrl, transport: origin => Effect.succeed({ origin: origin.origin, closed: Effect.never }) }),
                    gateway => ({ ...gateway, api: (method: string) => (method === 'identity' ? Effect.succeed(identityOf(record.id)) : gateway.api(method)) }),
                  ),
                ).pipe(Effect.provide(FetchHttpClient.layer), Effect.orDie),
            }),
          ),
        )
        yield* Effect.gen(function* () {
          const pool = yield* RuntimePool
          fixture.state.dropNext = 1
          const value = yield* pool.use(record.id, gateway => gateway.run({ namespace: 'session', method: 'list', args: { _request: {} } }), {
            mutation: false,
          })
          expect(value).toEqual({ items: [] })
          expect(yield* Ref.get(connections)).toBe(2)
          expect(fixture.calls.filter(url => url === '/api/session/list')).toHaveLength(2)
        }).pipe(Effect.provide(poolWith({ connectors: fake, runtimes: [record] })))
      }),
    ),
  )

  it.live('a mutation whose reply is lost is reported once, retires the connection, and is never replayed', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fixture = yield* startRuntimeFixture
        const connections = yield* Ref.make(0)
        const record = runtimeRecord(runtimeIds[0], fixture.launchUrl)
        const fake = Layer.effect(
          Connectors,
          Effect.succeed(
            Connectors.of({
              connect: () =>
                Effect.andThen(
                  Ref.update(connections, count => count + 1),
                  Effect.map(
                    connectGateway({ launchUrl: fixture.launchUrl, transport: origin => Effect.succeed({ origin: origin.origin, closed: Effect.never }) }),
                    gateway => ({ ...gateway, api: (method: string) => (method === 'identity' ? Effect.succeed(identityOf(record.id)) : gateway.api(method)) }),
                  ),
                ).pipe(Effect.provide(FetchHttpClient.layer), Effect.orDie),
            }),
          ),
        )
        yield* Effect.gen(function* () {
          const pool = yield* RuntimePool
          fixture.state.dropNext = 1
          const error = yield* Effect.flip(
            pool.use(record.id, gateway => gateway.run({ namespace: 'session', method: 'create', args: { request: { cwd: '/tmp/fixture' } } }), {
              mutation: true,
            }),
          )
          expect(error._tag).toBe('GatewayUnreachable')
          expect(fixture.calls.filter(url => url === '/api/session/create')).toHaveLength(1)
          expect(yield* pool.generation(record.id)).toBeUndefined()
          yield* pool.use(record.id, gateway => gateway.run({ namespace: 'session', method: 'list', args: { _request: {} } }), { mutation: false })
          expect(yield* Ref.get(connections)).toBe(2)
        }).pipe(Effect.provide(poolWith({ connectors: fake, runtimes: [record] })))
      }),
    ),
  )
})
