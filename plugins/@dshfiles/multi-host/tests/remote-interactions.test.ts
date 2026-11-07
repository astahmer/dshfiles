import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { type Cause, Effect, Layer, Queue, Ref, Schedule, type Scope, Stream } from 'effect'
import type { JsonValue } from '../src/api.js'
import { Connectors } from '../src/connectors/connectors.js'
import type { Gateway, RemoteEventOutcome } from '../src/connectors/gateway.js'
import { RemoteRequestFailed } from '../src/errors.js'
import { HostDirectory } from '../src/host-directory.js'
import { interactionGone, nextReconnectMillis, RemoteInteractions } from '../src/remote-interactions.js'
import { RuntimePool } from '../src/runtime-pool.js'
import { dataLayer } from './fixtures/data-runtime.js'

const runtimeId = '10000000-0000-4000-8000-000000000002' as const

/** One frame of the owner's event stream, as JSON. */
interface OwnerFrame {
  readonly type: string
  readonly [field: string]: JsonValue
}

interface FakeRuntime {
  /** The frames of the event stream currently open; a new connection reads from a new queue. */
  readonly send: (frame: OwnerFrame) => Effect.Effect<void>
  readonly dropStream: Effect.Effect<void>
  readonly results: Ref.Ref<readonly { readonly clientId: string; readonly eventId: string; readonly outcome: RemoteEventOutcome }[]>
  readonly claims: Ref.Ref<readonly unknown[]>
  readonly claimFrames: Queue.Queue<unknown, Cause.Done>
  readonly controlFrames: Queue.Queue<unknown, Cause.Done>
  readonly streams: Ref.Ref<number>
  readonly failAnswer: Ref.Ref<boolean>
  readonly layer: Layer.Layer<Connectors>
}

const fakeRuntime = Effect.gen(function* () {
  const current = yield* Ref.make<Queue.Queue<unknown, Cause.Done> | undefined>(undefined)
  const streams = yield* Ref.make(0)
  const results = yield* Ref.make<FakeRuntime['results'] extends Ref.Ref<infer A> ? A : never>([])
  const claims = yield* Ref.make<readonly unknown[]>([])
  const claimFrames = yield* Queue.unbounded<unknown, Cause.Done>()
  const controlFrames = yield* Queue.unbounded<unknown, Cause.Done>()
  const failAnswer = yield* Ref.make(false)

  const events = Stream.unwrap(
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<unknown, Cause.Done>()
      yield* Ref.set(current, queue)
      const generation = yield* Ref.updateAndGet(streams, count => count + 1)
      yield* Queue.offer(queue, { type: 'ready', clientId: `client-${String(generation)}`, host: { home: '/home/remote' } })
      return Stream.fromQueue(queue)
    }),
  )

  const gateway: Gateway = {
    origin: 'http://127.0.0.1:1',
    launchUrl: 'http://127.0.0.1:1/?token=test-token-12345678',
    closed: Effect.never,
    run: () => Effect.void,
    api: method =>
      method === 'identity'
        ? Effect.succeed({
            protocolVersion: 1,
            runtimeId,
            profile: 'interactions-test',
            homeLeaf: 'dsh-home',
            dshVersion: '0.2.1-rc.2',
            capabilities: ['workspace', 'session', 'agent'],
          })
        : Effect.void,
    pluginApi: () => () => Effect.void,
    follow: () => Effect.succeed([]),
    stream: request =>
      request.endpoint === 'session/control'
        ? Stream.fromQueue(controlFrames)
        : Stream.unwrap(
            Effect.as(
              Ref.update(claims, seen => [...seen, request]),
              Stream.fromQueue(claimFrames),
            ),
          ),
    events,
    answerEvent: input =>
      Effect.gen(function* () {
        if (yield* Ref.get(failAnswer)) return yield* new RemoteRequestFailed({ code: 'gateway/interactions-forbidden', detail: 'refused by the owner' })
        yield* Ref.update(results, seen => [...seen, input])
      }),
  }

  return {
    send: frame => Effect.flatMap(Ref.get(current), queue => (queue === undefined ? Effect.die('no open stream') : Effect.asVoid(Queue.offer(queue, frame)))),
    dropStream: Effect.flatMap(Ref.get(current), queue => (queue === undefined ? Effect.void : Effect.asVoid(Queue.end(queue)))),
    results,
    claims,
    claimFrames,
    controlFrames,
    streams,
    failAnswer,
    layer: Layer.succeed(Connectors, Connectors.of({ connect: () => Effect.succeed(gateway) })),
  } satisfies FakeRuntime
})

const registered = Layer.effectDiscard(
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
    yield* directory.upsertRuntime({
      schemaVersion: 2,
      id: runtimeId,
      hostId: 'local',
      name: 'remote host',
      locator: { kind: 'local', launchUrl: 'http://127.0.0.1:1/?token=pool-token-123456' },
      identity: {
        protocolVersion: 1,
        runtimeId,
        profile: 'interactions-test',
        homeLeaf: 'dsh-home',
        dshVersion: '0.2.1-rc.2',
        capabilities: ['workspace', 'session', 'agent'],
      },
      createdAt: '2026-10-05T00:00:00.000Z',
    })
  }),
)

const servicesFor = (runtime: FakeRuntime) =>
  RemoteInteractions.layer.pipe(
    Layer.provideMerge(RuntimePool.layer),
    Layer.provideMerge(registered),
    Layer.provide(runtime.layer),
    Layer.provideMerge(dataLayer({ DSH_HOME: mkdtempSync(join(tmpdir(), 'multi-host-interactions-')) })),
  )

const question = (eventId: string, wait?: { readonly callId: string; readonly timed: boolean }) => ({
  type: 'waterfall',
  event: 'user-questions/request',
  eventId,
  agentId: 'session-remote',
  request: { questions: [{ id: 'q1', question: 'Ship it?', options: [{ label: 'Yes' }] }], ...(wait !== undefined && { wait }) },
})

const approval = (eventId: string) => ({
  type: 'waterfall',
  event: 'approval/request',
  eventId,
  agentId: 'session-remote',
  request: { toolName: 'bash', callId: 'call-1', reason: 'needs the network' },
})

/** Wait for the bridge fiber to reach a state, without a fixed sleep. */
const eventually = <A>(read: Effect.Effect<A>, done: (value: A) => boolean, times = 400) =>
  read.pipe(
    Effect.flatMap(value => (done(value) ? Effect.succeed(value) : Effect.fail('pending' as const))),
    Effect.retry({ times, schedule: Schedule.spaced('5 millis') }),
    Effect.orDie,
  )

const settled = (test: (runtime: FakeRuntime) => Effect.Effect<void, unknown, RemoteInteractions | Scope.Scope>) =>
  Effect.gen(function* () {
    const runtime = yield* fakeRuntime
    yield* test(runtime).pipe(Effect.provide(servicesFor(runtime)), Effect.scoped)
  })

describe('RemoteInteractions', () => {
  it.live('holds a question and an approval the owner delivered, and answers each on that client', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send(question('event-1'))
        yield* runtime.send(approval('event-2'))
        const rows = yield* eventually(interactions.list, held => held.length === 2)
        expect(rows.map(row => row.request.kind)).toEqual(['question', 'approval'])
        expect(rows[0]).toMatchObject({ id: 'event-1', runtimeId, sessionId: 'session-remote' })

        const first = rows[0]
        if (first === undefined) throw new Error('expected a held question')
        yield* interactions.settle({ interaction: first, outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['Yes'] }] } } })
        expect(yield* Ref.get(runtime.results)).toEqual([
          { clientId: 'client-1', eventId: 'event-1', outcome: { kind: 'result', value: { answers: [{ id: 'q1', selected: ['Yes'] }] } } },
        ])
        expect((yield* interactions.list).map(row => row.id)).toEqual(['event-2'])
      }),
    ),
  )

  it.live('records one span per answer, naming no question text', () =>
    settled(runtime =>
      Effect.gen(function* () {
        using recorder = recordSpans()
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send(approval('event-1'))
        const [held] = yield* eventually(interactions.list, rows => rows.length === 1)
        if (held === undefined) throw new Error('expected a held approval')
        yield* interactions.settle({ interaction: held, outcome: { kind: 'result', value: 'allowed-once' } })
        const span = recorder.span('multi-host remote interaction settle')
        expect(span.status.code).not.toBe('error')
        expect(JSON.stringify(span.attributes)).not.toContain('needs the network')
      }).pipe(Effect.provide(tracerLayer)),
    ),
  )

  it.live('drops a request the owner withdrew, so a late answer is refused here', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send(approval('event-1'))
        const [held] = yield* eventually(interactions.list, rows => rows.length === 1)
        yield* runtime.send({ type: 'cancel', eventId: 'event-1' })
        yield* eventually(interactions.list, rows => rows.length === 0)
        if (held === undefined) throw new Error('expected a held approval')
        expect(yield* interactions.settle({ interaction: held, outcome: { kind: 'result', value: 'allowed-once' } })).toEqual(interactionGone)
        expect(yield* Ref.get(runtime.results)).toEqual([])
      }),
    ),
  )

  it.live('keeps a request the owner refused the answer for, and reports the owner’s word', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send(approval('event-1'))
        const [held] = yield* eventually(interactions.list, rows => rows.length === 1)
        if (held === undefined) throw new Error('expected a held approval')
        yield* Ref.set(runtime.failAnswer, true)
        const refused = yield* Effect.flip(interactions.settle({ interaction: held, outcome: { kind: 'result', value: 'allowed-once' } }))
        expect(refused).toBeInstanceOf(RemoteRequestFailed)
        expect((yield* interactions.list).map(row => row.id)).toEqual(['event-1'])
      }),
    ),
  )

  it.live('claims a timed wait and reports what it has left', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send(question('event-1', { callId: 'call-1', timed: true }))
        yield* eventually(Ref.get(runtime.claims), seen => seen.length === 1)
        expect(yield* Ref.get(runtime.claims)).toEqual([{ endpoint: 'userQuestions/attachWait', args: { agentId: 'session-remote', callId: 'call-1' } }])
        // A card that mounted now would take focus, and focus freezes the countdown the owner is about to report.
        expect(yield* interactions.list).toEqual([])
        yield* Queue.offer(runtime.claimFrames, { remainingMs: 60_000 })
        const [row] = yield* eventually(interactions.list, rows => rows[0]?.request.kind === 'question' && rows[0].request.remainingMs !== undefined)
        expect(row?.request).toMatchObject({ kind: 'question', callId: 'call-1' })
      }),
    ),
  )

  it.live('opens a stream for a runtime a browser asks about, without any thread being followed', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.watch([runtimeId])
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send(approval('event-1'))
        yield* eventually(interactions.list, rows => rows.length === 1)
        yield* interactions.watch([runtimeId])
        expect(yield* Ref.get(runtime.streams)).toBe(1)
      }),
    ),
  )

  it('backs off while a runtime keeps failing and starts over after a healthy connection', () => {
    expect(nextReconnectMillis({ previousMillis: 3_000, connectedMillis: 50 })).toBe(6_000)
    expect(nextReconnectMillis({ previousMillis: 48_000, connectedMillis: 50 })).toBe(60_000)
    expect(nextReconnectMillis({ previousMillis: 60_000, connectedMillis: 50 })).toBe(60_000)
    expect(nextReconnectMillis({ previousMillis: 60_000, connectedMillis: 30_000 })).toBe(3_000)
  })

  it.live('hands on the projection values its follow stream does not carry, and leaves the baseline to that snapshot', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        const received = yield* Queue.unbounded<unknown>()
        yield* Effect.forkScoped(Stream.runForEach(interactions.projections, update => Queue.offer(received, update)))
        yield* Effect.sleep('20 millis')
        yield* Queue.offer(runtime.controlFrames, { type: 'baseline', value: { projections: {} } })
        yield* Queue.offer(runtime.controlFrames, { type: 'projection', sessionId: 'session-remote', key: 'userQuestions', value: { active: [] }, seq: 7 })
        expect(yield* Queue.take(received)).toEqual({ sessionId: 'session-remote', key: 'userQuestions', value: { active: [] }, seq: 7 })
      }),
    ),
  )

  it.live('still presents a timed question when the owner refuses the claim', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send(question('event-1', { callId: 'call-1', timed: true }))
        yield* eventually(Ref.get(runtime.claims), seen => seen.length === 1)
        yield* Queue.end(runtime.claimFrames)
        const [row] = yield* eventually(interactions.list, rows => rows.length === 1)
        expect(row?.request).not.toHaveProperty('remainingMs')
      }),
    ),
  )

  it.live('does not claim a blocking question', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send(question('event-1'))
        yield* eventually(interactions.list, rows => rows.length === 1)
        expect(yield* Ref.get(runtime.claims)).toEqual([])
      }),
    ),
  )

  it.live(
    'forgets deliveries when the stream ends and takes what the owner delivers again on the next one',
    () =>
      settled(runtime =>
        Effect.gen(function* () {
          const interactions = yield* RemoteInteractions
          yield* interactions.hold(runtimeId)
          yield* eventually(Ref.get(runtime.streams), count => count === 1)
          yield* runtime.send(question('event-1'))
          yield* eventually(interactions.list, rows => rows.length === 1)
          yield* runtime.dropStream
          yield* eventually(interactions.list, rows => rows.length === 0)
          yield* eventually(Ref.get(runtime.streams), count => count === 2, 2_000)
          yield* runtime.send(question('event-1'))
          const [row] = yield* eventually(interactions.list, rows => rows.length === 1)
          if (row === undefined) throw new Error('expected a held question')
          expect(row.id).toBe('event-1')
          yield* interactions.settle({ interaction: row, outcome: { kind: 'result', value: { answers: [] } } })
          expect((yield* Ref.get(runtime.results)).map(result => result.clientId)).toEqual(['client-2'])
        }),
      ),
    15_000,
  )

  it.live('ignores what it does not hold: emits, unknown events and undecodable requests', () =>
    settled(runtime =>
      Effect.gen(function* () {
        const interactions = yield* RemoteInteractions
        yield* interactions.hold(runtimeId)
        yield* eventually(Ref.get(runtime.streams), count => count === 1)
        yield* runtime.send({ type: 'emit', event: 'api-session/activity', args: ['session-remote'] })
        yield* runtime.send({ type: 'waterfall', event: 'something/else', eventId: 'event-x', agentId: 'session-remote', request: {} })
        yield* runtime.send({ type: 'waterfall', event: 'approval/request', eventId: 'event-y', agentId: 'session-remote', request: { toolName: 7 } })
        yield* runtime.send(approval('event-z'))
        const rows = yield* eventually(interactions.list, held => held.length === 1)
        expect(rows.map(row => row.id)).toEqual(['event-z'])
      }),
    ),
  )
})
