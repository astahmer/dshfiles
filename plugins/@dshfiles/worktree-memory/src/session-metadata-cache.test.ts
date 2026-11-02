import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Layer, Ref, Tracer } from 'effect'
import { TestClock } from 'effect/testing'
import { HostDirectory } from './host-edge-promise.js'
import type { KnownSession } from './process-table.js'
import { SessionMetadata } from './session-metadata-cache.js'

const session: KnownSession = {
  sessionId: 'session-1',
  cwd: '/repo',
  running: false,
  updatedAt: 100,
  title: 'Cached thread',
}

/** The Host Session controller is external to the plugin; each test scripts what its list answers. */
const directoryAnswering = (answer: Effect.Effect<readonly KnownSession[] | undefined>) =>
  Effect.gen(function* () {
    const loads = yield* Ref.make(0)
    const directory = Layer.succeed(
      HostDirectory,
      HostDirectory.of({
        sessions: Effect.andThen(
          Ref.update(loads, count => count + 1),
          answer,
        ),
        workspaces: Effect.succeed([]),
      }),
    )
    const metadata = Context.get(yield* Layer.build(SessionMetadata.layer.pipe(Layer.provide(directory))), SessionMetadata)
    return { metadata, loads: Ref.get(loads) }
  })

const recordSpanNames = () => {
  const names: string[] = []
  const tracer = Tracer.make({
    span: options => {
      names.push(options.name)
      return new Tracer.NativeSpan(options)
    },
  })
  return { names, trace: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.withTracer(effect, tracer) }
}

describe('SessionMetadata', () => {
  it.effect('returns the current value without waiting and coalesces a refresh', () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(1)
        const pending = yield* Deferred.make<readonly KnownSession[] | undefined>()
        const { metadata, loads } = yield* directoryAnswering(Deferred.await(pending))

        const recorder = recordSpanNames()
        expect(yield* recorder.trace(metadata.current)).toEqual([])
        expect(yield* metadata.current).toEqual([])

        yield* Deferred.succeed(pending, [session])
        yield* metadata.refresh
        expect(recorder.names).toContain('worktree-memory list sessions')

        expect(yield* metadata.current).toEqual([session])
        expect(yield* loads).toBe(1)
      }),
    ),
  )

  it.effect('keeps the last good value and backs off a failed refresh', () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(1)
        const answer = yield* Ref.make<readonly KnownSession[] | undefined>([session])
        const { metadata, loads } = yield* directoryAnswering(Ref.get(answer))

        yield* metadata.refresh
        expect(yield* metadata.current).toEqual([session])
        expect(yield* loads).toBe(1)

        yield* TestClock.adjust(30_000)
        yield* Ref.set(answer, undefined)
        yield* metadata.refresh
        expect(yield* metadata.current).toEqual([session])
        expect(yield* loads).toBe(2)

        yield* Ref.set(answer, [session])
        yield* TestClock.adjust(44_999)
        yield* metadata.refresh
        expect(yield* loads).toBe(2)
        yield* TestClock.adjust(1)
        yield* metadata.refresh
        expect(yield* loads).toBe(3)
      }),
    ),
  )
})
