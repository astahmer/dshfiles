import { mkdtempSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from '@effect/vitest'
import { Cause, Effect, Exit, Fiber, Layer, Stream } from 'effect'
import { TestClock } from 'effect/testing'
import { Connectors } from '../src/connectors/connectors.js'
import type { Gateway } from '../src/connectors/gateway.js'
import { RemoteRequestFailed } from '../src/errors.js'
import { HostDirectory } from '../src/host-directory.js'
import { RemoteInteractions } from '../src/remote-interactions.js'
import { RemoteSessions } from '../src/remote-sessions.js'
import { RemoteThreads } from '../src/remote-threads.js'
import { RuntimePool } from '../src/runtime-pool.js'
import { dataLayer } from './fixtures/data-runtime.js'

// The scoped Session source: which runtime owns a Session, and that every routed call reaches its owner. The former
// promise source is gone; the source is now built from the pool and the directory, so the pool is faked by connectors.

const runtimeId = '10000000-0000-4000-8000-000000000001' as const

const row = (sessionId: string, extra: Record<string, unknown> = {}) => ({
  sessionId,
  updatedAt: 100,
  running: false,
  blank: false,
  agentAvailable: true,
  cwd: '/remote/repo',
  projections: { values: { title: 'remote thread' } },
  ...extra,
})

interface Fixture {
  readonly calls: { readonly method: string; readonly args: unknown }[]
  readonly routed: { readonly method: string; readonly mutation: boolean }[]
  readonly layer: Layer.Layer<Connectors>
  readonly setStreamed: (frames: readonly unknown[]) => void
  readonly setPromptFailure: (failure: RemoteRequestFailed) => void
  readonly setEvents: (events: Stream.Stream<unknown>) => void
  readonly setStream: (stream: Stream.Stream<unknown>) => void
  readonly released: () => number
}

const fixture = (): Fixture => {
  const calls: { method: string; args: unknown }[] = []
  const routed: { method: string; mutation: boolean }[] = []
  let streamed: readonly unknown[] = [{ type: 'snapshot', cursor: 0, records: [], hasMore: false, projections: { asOfSeq: 0, values: {} } }]
  let releases = 0
  let promptFailure: RemoteRequestFailed | undefined
  let events: Stream.Stream<unknown> = Stream.never
  let followed: Stream.Stream<unknown> | undefined
  const gateway = (): Gateway => ({
    origin: 'http://127.0.0.1:1',
    launchUrl: 'http://127.0.0.1:1/?token=test-token-12345678',
    closed: Effect.never,
    stream: request => (request.endpoint === 'session/control' ? Stream.never : (followed ?? Stream.fromIterable(streamed))),
    run: request => {
      calls.push({ method: request.method, args: request.args })
      if (request.method === 'list') return Effect.succeed({ items: [row('session-remote', { transportSecret: 'discard me' })] })
      if (request.method === 'page') return Effect.succeed({ records: [], hasMore: false })
      if (request.method === 'projections')
        return Effect.succeed({
          kind: 'sequenced',
          asOfSeq: 4,
          values: {
            modelSelection: { lastUsed: { provider: 'deepseek', model: 'chat' }, next: { provider: 'deepseek', model: 'reasoner', reasoningEffort: 'high' } },
          },
        })
      if (request.method === 'selectModel') return Effect.succeed({ selected: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } })
      if (request.method === 'create') return Effect.succeed({ sessionId: 'session-created' })
      if (request.method === 'fork') return Effect.succeed({ sessionId: 'session-forked' })
      if (request.method === 'rename') return Effect.succeed({ title: 'Renamed', seq: 9 })
      if (request.method === 'prompt' && promptFailure !== undefined) return Effect.fail(promptFailure)
      return Effect.succeed({ accepted: true })
    },
    api: method =>
      method === 'identity'
        ? Effect.succeed({
            protocolVersion: 1,
            runtimeId,
            profile: 'remote-sessions-test',
            homeLeaf: 'dsh-home',
            dshVersion: '0.2.1-rc.2',
            capabilities: ['workspace', 'session', 'agent'],
          })
        : Effect.void,
    pluginApi: () => () => Effect.void,
    follow: () => Effect.succeed(streamed),
    events: Stream.suspend(() => events),
    answerEvent: () => Effect.void,
  })
  return {
    calls,
    routed,
    setStreamed: frames => {
      streamed = frames
    },
    setPromptFailure: failure => {
      promptFailure = failure
    },
    setEvents: stream => {
      events = stream
    },
    setStream: stream => {
      followed = stream
    },
    released: () => releases,
    layer: Layer.succeed(
      Connectors,
      Connectors.of({
        connect: () =>
          Effect.gen(function* () {
            const connection = gateway()
            yield* Effect.addFinalizer(() => Effect.sync(() => (releases += 1)))
            return connection
          }),
      }),
    ),
  }
}

const home = () => mkdtempSync(join(tmpdir(), 'multi-host-sessions-'))

const layerWith = (test: Fixture, sessions: readonly { readonly sessionId: string; readonly runtimeId: string; readonly cwd?: string }[]) =>
  Effect.gen(function* () {
    const directory = yield* HostDirectory
    const threads = yield* RemoteThreads
    yield* directory.upsertHost({
      schemaVersion: 2,
      id: 'local',
      name: 'Local',
      connector: { kind: 'local' },
      hidden: false,
      createdAt: '2026-10-05T00:00:00.000Z',
    })
    yield* directory.upsertRuntime({
      schemaVersion: 2,
      id: runtimeId,
      hostId: 'local',
      name: 'remote host',
      locator: { kind: 'local', launchUrl: 'http://127.0.0.1:1/?token=pool-token-123456' },
      // The pool verifies the pinned identity before it serves a connection, so the fixture pins the one it answers.
      identity: {
        protocolVersion: 1,
        runtimeId,
        profile: 'remote-sessions-test',
        homeLeaf: 'dsh-home',
        dshVersion: '0.2.1-rc.2',
        capabilities: ['workspace', 'session', 'agent'],
      },
      createdAt: '2026-10-05T00:00:00.000Z',
    })
    for (const thread of sessions)
      yield* threads.record({
        runtimeId: thread.runtimeId,
        sessionId: thread.sessionId,
        cwd: thread.cwd ?? '/remote/repo',
        title: '',
        createdAt: '2026-10-05T00:00:00.000Z',
      })
  })

const services = (test: Fixture, sessions: readonly { readonly sessionId: string; readonly runtimeId: string; readonly cwd?: string }[] = []) =>
  RemoteSessions.layer.pipe(
    Layer.provideMerge(RemoteInteractions.layer),
    Layer.provideMerge(RuntimePool.layer),
    Layer.provideMerge(Layer.effectDiscard(layerWith(test, sessions))),
    Layer.provideMerge(test.layer),
    Layer.provideMerge(dataLayer({ DSH_HOME: home() })),
  )

describe('RemoteSessions', () => {
  it.effect('lists a runtime’s Sessions and remembers which runtime owns them', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      const rows = yield* sessions.source.list({ projections: ['title'] })
      expect(rows.map(item => String(item.sessionId))).toEqual(['session-remote'])
      expect(rows[0]).not.toHaveProperty('transportSecret')
      const owner = yield* sessions.source.runtimeIdForSession?.('session-remote') ?? Effect.succeed({ _tag: 'None' })
      expect(owner).toMatchObject({ _tag: 'Some', value: runtimeId })
      expect(test.calls).toEqual([{ method: 'list', args: { _request: { projections: ['title'] } } }])
      expect(yield* sessions.source.owns('session-remote' as SessionId)).toBe(true)
      expect(yield* sessions.source.owns('session-unknown' as SessionId)).toBe(false)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('answers concurrent ownership lookups of one Session from a single discovery', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      const remote = SessionId('session-remote')
      const answers = yield* Effect.all([sessions.source.owns(remote), sessions.source.owns(remote)], { concurrency: 'unbounded' })
      expect(answers).toEqual([true, true])
      expect(test.calls.filter(call => call.method === 'list')).toHaveLength(1)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('streams a followed Session through the pooled connection', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      const frames = yield* Stream.runCollect(
        sessions.source.follow?.({ address: { kind: 'session', sessionId: 'session-remote' as SessionId } }) ?? Stream.empty,
      )
      expect([...frames]).toHaveLength(1)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('keeps the runtime reachable for as long as a thread is followed, and lets go after it ends', () => {
    const test = fixture()
    let opened = 0
    let closed = 0
    test.setEvents(
      Stream.unwrap(
        Effect.sync(() => {
          opened += 1
          return Stream.never
        }),
      ).pipe(
        Stream.ensuring(
          Effect.sync(() => {
            closed += 1
          }),
        ),
      ),
    )
    test.setStream(Stream.never)
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      const interactions = yield* RemoteInteractions
      yield* sessions.source.list({})
      const follow = sessions.source.follow?.({ address: { kind: 'session', sessionId: 'session-remote' as SessionId } } as never)
      if (follow === undefined) throw new Error('The source follows Sessions.')
      // The directory and the connection are real I/O, which a virtual clock does not advance.
      const settle = TestClock.withLive(Effect.sleep('200 millis'))
      const fiber = yield* Effect.forkChild(Stream.runDrain(follow))
      yield* settle
      expect(opened).toBe(1)
      // Far past the bridge's idle window: only a follow that really holds it keeps its stream open.
      yield* TestClock.adjust('10 minutes')
      yield* settle
      expect({ opened, closed }).toEqual({ opened: 1, closed: 0 })
      yield* Fiber.interrupt(fiber)
      yield* TestClock.adjust('10 minutes')
      yield* settle
      expect({ opened, closed }).toEqual({ opened: 1, closed: 1 })
      expect(yield* interactions.list).toEqual([])
    }).pipe(Effect.provide(services(test)))
  })

  it.effect("forks on the owning runtime and records the new thread as that runtime's", () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      const threads = yield* RemoteThreads
      const fork = sessions.source.fork
      if (fork === undefined) throw new Error('The source forks Sessions.')
      const created = yield* fork({ sessionId: 'session-remote' as SessionId })
      expect(created.sessionId).toBe('session-forked')
      expect(test.calls.map(call => call.method)).toContain('fork')
      expect((yield* threads.list).find(thread => thread.sessionId === 'session-forked')).toMatchObject({ runtimeId, cwd: '/remote/repo' })
    }).pipe(Effect.provide(services(test, [{ sessionId: 'session-remote', runtimeId }])))
  })

  it.effect('forwards a prompt to the owning runtime unchanged', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      const request = {
        requestId: 'request-1',
        sessionId: 'session-remote' as SessionId,
        mode: 'queue' as const,
        content: [{ type: 'text' as const, text: 'hello' }],
      }
      yield* sessions.source.prompt?.(request) ?? Effect.void
      expect(test.calls.at(-1)).toEqual({ method: 'prompt', args: { request } })
    }).pipe(Effect.provide(services(test)))
  })

  const prompted = (test: Fixture) => test.calls.some(call => call.method === 'prompt')

  it.effect('refuses a mention under this machine home before it reaches the runtime', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      const exit = yield* Effect.exit(
        sessions.source.prompt?.({
          requestId: 'request-1',
          sessionId: 'session-remote',
          mode: 'queue',
          content: [{ type: 'text', text: `read @${homedir()}/notes.md` }],
        } as never) ?? Effect.void,
      )
      expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toMatchObject({ _tag: 'SessionPromptRefused' })
      expect(prompted(test)).toBe(false)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('sends a mention inside the thread folder and prose naming a home path', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      yield* (
        sessions.source.prompt?.({
          requestId: 'request-1',
          sessionId: 'session-remote',
          mode: 'queue',
          content: [{ type: 'text', text: `@/remote/repo/x.ts and ${homedir()}/notes.md` }],
        } as never) ?? Effect.void
      )
      expect(prompted(test)).toBe(true)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('refuses an upload staged for another thread before it reaches the runtime', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      yield* sessions.recordUpload({ receiptId: 'receipt-1', runtimeId, sessionId: 'session-other' })
      const exit = yield* Effect.exit(
        sessions.source.prompt?.({
          requestId: 'request-1',
          sessionId: 'session-remote',
          mode: 'queue',
          content: [{ type: 'file', receiptId: 'receipt-1' }],
        } as never) ?? Effect.void,
      )
      expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toMatchObject({ _tag: 'SessionPromptRefused' })
      expect(prompted(test)).toBe(false)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('says how to recover when the owning runtime does not hold an attachment', () => {
    const test = fixture()
    test.setPromptFailure(new RemoteRequestFailed({ code: 'session/attachment-invalid', detail: 'File was not uploaded for this session.' }))
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      const exit = yield* Effect.exit(
        sessions.source.prompt?.({
          requestId: 'request-1',
          sessionId: 'session-remote',
          mode: 'queue',
          content: [{ type: 'file', receiptId: 'receipt-unknown' }],
        } as never) ?? Effect.void,
      )
      expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toMatchObject({ _tag: 'SessionPromptRefused' })
      expect(prompted(test)).toBe(true)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('applies the same rule to a queued message edit', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      const exit = yield* Effect.exit(
        sessions.source.updateQueue?.({
          sessionId: 'session-remote',
          itemId: 'item-1',
          action: { kind: 'edit', content: [{ type: 'text', text: '@~/notes.md' }] },
        } as never) ?? Effect.void,
      )
      expect(Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined).toMatchObject({ _tag: 'SessionPromptRefused' })
      expect(test.calls.some(call => call.method === 'updateQueue')).toBe(false)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('does not report a runtime that recorded ownership names but the directory no longer has', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      const owner = yield* sessions.source.runtimeIdForSession?.('session-remote') ?? Effect.succeed({ _tag: 'None' })
      expect(owner).toMatchObject({ _tag: 'Some' })
    }).pipe(Effect.provide(services(test, [{ sessionId: 'session-unregistered', runtimeId: 'runtime-2' }])))
  })

  it.effect('recovers a recorded Session the runtime has not listed yet as a blank row', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      const rows = yield* sessions.source.list({})
      expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 'session-created', cwd: '/remote/new', blank: true, running: false })]))
    }).pipe(Effect.provide(services(test, [{ sessionId: 'session-created', runtimeId, cwd: '/remote/new' }])))
  })

  it.effect('refuses a Session no runtime owns instead of answering for it', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      const exit = yield* Effect.exit(
        sessions.source.page?.({ address: { kind: 'session', sessionId: 'session-unknown' as SessionId }, throughSeq: 0 }) ?? Effect.void,
      )
      expect(exit._tag).toBe('Failure')
      expect(test.calls.some(call => call.method === 'page')).toBe(false)
    }).pipe(Effect.provide(services(test)))
  })

  it.effect('routes model selection with reasoning effort to the Session owner', () => {
    const test = fixture()
    return Effect.gen(function* () {
      const sessions = yield* RemoteSessions
      yield* sessions.source.list({})
      const selected = yield* (
        sessions.source.selectModel?.({ sessionId: 'session-remote' as SessionId, provider: 'deepseek', model: 'chat', reasoningEffort: 'high' }) ??
          Effect.succeed(undefined)
      )
      expect(selected).toEqual({ selected: { provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } })
      expect(test.calls.at(-1)).toEqual({
        method: 'selectModel',
        args: { request: { sessionId: 'session-remote', provider: 'deepseek', model: 'chat', reasoningEffort: 'high' } },
      })
    }).pipe(Effect.provide(services(test)))
  })
})
