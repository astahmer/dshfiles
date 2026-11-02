import { describe, expect, test } from 'vitest'
import { SessionId } from '@dshfiles/dshx/ids'
import { it } from '@effect/vitest'
import { Context, Effect, Layer, Option, Schema, Stream } from 'effect'
import {
  createSessionSourceRegistry,
  fromEffect,
  SessionPayload,
  SessionPayloadError,
  SessionSourcePayload,
  SessionSources,
  type MirroredSessionSource,
} from './index.js'

const id = Schema.decodeUnknownSync(SessionId)

const source = (sourceId: string, owned: readonly string[]): MirroredSessionSource => ({
  id: sourceId,
  label: sourceId,
  list: async () => [],
  owns: sessionId => owned.includes(sessionId),
})

describe('session source registry', () => {
  test('claims follow a source and are forgotten with it', () => {
    const registry = createSessionSourceRegistry()
    const remote = source('remote', ['session-a'])
    const unregister = registry.register(remote)
    registry.claim(remote, [id('session-a'), id('session-b')])

    expect(registry.sources()).toEqual([remote])
    expect(registry.ownerOf(id('session-a'))).toBe(remote)

    unregister()
    expect(registry.sources()).toEqual([])
    expect(registry.ownerOf(id('session-a'))).toBeUndefined()
  })

  test('resolveOwner asks each source only when nothing is claimed', async () => {
    const registry = createSessionSourceRegistry()
    const asked: string[] = []
    const first: MirroredSessionSource = {
      ...source('first', []),
      owns: sessionId => {
        asked.push(`first:${sessionId}`)
        return false
      },
    }
    const second: MirroredSessionSource = {
      ...source('second', []),
      owns: sessionId => {
        asked.push(`second:${sessionId}`)
        return sessionId === 'session-b'
      },
    }
    registry.register(first)
    registry.register(second)

    await expect(registry.resolveOwner(id('session-b'))).resolves.toBe(second)
    expect(asked).toEqual(['first:session-b', 'second:session-b'])
    expect(registry.ownerOf(id('session-b'))).toBe(second)

    asked.length = 0
    await expect(registry.resolveOwner(id('session-b'))).resolves.toBe(second)
    expect(asked).toEqual([])
  })

  test('a cached claim of an unregistered source is dropped before asking', async () => {
    const registry = createSessionSourceRegistry()
    const remote = source('remote', ['session-a'])
    const unregister = registry.register(remote)
    registry.claim(remote, [id('session-a')])
    unregister()

    const other = source('other', ['session-a'])
    registry.register(other)
    await expect(registry.resolveOwner(id('session-a'))).resolves.toBe(other)
  })

  test('an id no source owns resolves to nothing', async () => {
    const registry = createSessionSourceRegistry()
    registry.register(source('remote', ['session-a']))
    await expect(registry.resolveOwner(id('session-z'))).resolves.toBeUndefined()
    expect(registry.ownerOf(id('session-z'))).toBeUndefined()
  })
})

describe('SessionSources', () => {
  it.effect('registers a source for a Scope and forgets its claims when the Scope closes', () =>
    Effect.gen(function* () {
      const registry = createSessionSourceRegistry()
      const remote = source('remote', ['session-a'])
      const owner = yield* Effect.scoped(
        Effect.gen(function* () {
          const sources = yield* SessionSources
          yield* sources.register(remote)
          yield* sources.claim(remote, [id('session-a')])
          return yield* sources.resolveOwner(id('session-a'))
        }),
      ).pipe(Effect.provide(SessionSources.fromRegistry(registry)))

      expect(owner).toEqual(Option.some(remote))
      expect(registry.sources()).toEqual([])
      expect(registry.ownerOf(id('session-a'))).toBeUndefined()
    }),
  )

  it.effect('keeps the cause when a source fails the ownership test', () =>
    Effect.gen(function* () {
      const registry = createSessionSourceRegistry()
      registry.register({ ...source('broken', []), owns: async () => Promise.reject(new Error('tunnel closed')) })
      const sources = yield* Effect.provide(SessionSources, SessionSources.fromRegistry(registry))
      const failure = yield* sources.resolveOwner(id('session-a')).pipe(Effect.flip)
      expect(failure.sessionId).toBe('session-a')
      expect(failure.cause).toEqual(new Error('tunnel closed'))
    }),
  )
})

describe('SessionPayload', () => {
  it.effect('decodes wire payloads keeping unnamed fields, and reports the schema issue', () =>
    Effect.gen(function* () {
      const rows = yield* SessionPayload.summaries({
        items: [{ sessionId: 'session-a', updatedAt: 1, running: false, blank: false, agentAvailable: true, extra: 'kept' }],
      })
      expect(rows).toEqual([{ sessionId: 'session-a', updatedAt: 1, running: false, blank: false, agentAvailable: true, extra: 'kept' }])
      expect(yield* SessionPayload.prompt({ accepted: true, seq: 4 })).toEqual({ accepted: true, seq: 4 })

      const failure = yield* SessionPayload.page({ records: 'nope', hasMore: false }).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(SessionPayloadError)
      expect(failure.payload).toBe('page')
      expect(String(failure.cause)).toContain('records')
    }),
  )

  test('the synchronous decoders throw the same error', () => {
    expect(() => SessionSourcePayload.cancel({ accepted: false })).toThrow(SessionPayloadError)
    expect(SessionSourcePayload.projections(null)).toBeNull()
  })
})

describe('fromEffect', () => {
  class Greeting extends Context.Service<Greeting, { readonly prefix: string }>()('test/Greeting') {}

  it.effect('runs an Effect source through the Promise port with the services that built it', () =>
    Effect.gen(function* () {
      const port = yield* fromEffect<Greeting>({
        id: 'effect-source',
        label: 'Effect source',
        list: () => Effect.succeed([]),
        owns: sessionId => Effect.map(Greeting, greeting => sessionId.startsWith(greeting.prefix)),
        runtimeIdForSession: () => Effect.succeed(Option.none()),
        follow: () => Stream.fromEffect(SessionPayload.followFrame({ type: 'snapshot' })).pipe(Stream.concat(Stream.never)),
      })
      expect(yield* Effect.promise(async () => port.owns(id('remote-1')))).toBe(true)
      expect(yield* Effect.promise(async () => port.owns(id('local-1')))).toBe(false)
      expect(yield* Effect.promise(async () => port.runtimeIdForSession?.('remote-1'))).toBeUndefined()

      const controller = new AbortController()
      const frames = yield* Effect.promise(async () => {
        const received: unknown[] = []
        const stream = port.follow?.({ address: { kind: 'session', sessionId: id('remote-1') } }, controller.signal)
        if (stream === undefined) return received
        for await (const frame of stream) {
          received.push(frame)
          controller.abort()
        }
        return received
      })
      expect(frames).toEqual([{ type: 'snapshot' }])
      expect(port.page).toBeUndefined()
    }).pipe(Effect.provide(Layer.succeed(Greeting, Greeting.of({ prefix: 'remote-' })))),
  )
})
