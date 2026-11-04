import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Fiber, Layer, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { catalogWithCli } from './secret-catalog-fixture.js'
import { SecretCatalog } from './secret-catalog.js'
import { MAX_PENDING_SECRET_REQUESTS, SecretRequests, type SecretRequestInput } from './secret-requests.js'

const SYNTHETIC_VALUE = 'synthetic-requested-secret-value'

/** A stand-in CLI whose `set` adds the alias to what `print` lists, so a stored request can be checked against it. */
const withRequests = <A, E>(body: (requests: SecretRequests['Service'], catalog: SecretCatalog['Service']) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const aliases = yield* Ref.make<readonly { alias: string; environment: string }[]>([])
    const revision = yield* Ref.make(0)
    const fixture = catalogWithCli(
      request =>
        Effect.gen(function* () {
          if (request.args[0] === 'print') return JSON.stringify(yield* Ref.get(aliases))
          if (request.args[0] === 'set') {
            const environment = request.args[request.args.indexOf('--env') + 1] ?? 'prod'
            yield* Ref.update(aliases, current => [...current, { alias: request.args[1] ?? '', environment }])
            yield* Ref.update(revision, count => count + 1)
          }
          return ''
        }),
      () => Effect.map(Ref.get(revision), String),
    )
    const layer = SecretRequests.layer.pipe(Layer.provideMerge(fixture.layer))
    return yield* Effect.gen(function* () {
      return yield* body(yield* SecretRequests, yield* SecretCatalog)
    }).pipe(Effect.provide(layer))
  })

const input = (overrides: Partial<SecretRequestInput> = {}): SecretRequestInput => ({
  sessionId: 'session-a',
  alias: 'SYNTHETIC_TOKEN',
  environment: 'prod',
  scope: 'global',
  cwd: '/tmp/project',
  purpose: 'Call the synthetic API.',
  timeoutMs: 60_000,
  ...overrides,
})

const awaitPending = (requests: SecretRequests['Service'], count: number) =>
  Effect.gen(function* () {
    for (;;) {
      const views = yield* requests.pending(null)
      if (views.length >= count) return views
      yield* Effect.yieldNow
    }
  })

describe('Secret requests', () => {
  it.effect('settles a waiting request with the reference of a value the user stored, never the value', () =>
    withRequests((requests, catalog) =>
      Effect.gen(function* () {
        const asking = yield* Effect.forkChild(requests.ask(input({ environment: 'staging' })))
        const [pending] = yield* awaitPending(requests, 1)
        expect(pending).toMatchObject({ alias: 'SYNTHETIC_TOKEN', environment: 'staging', scope: 'global', cwd: null, sessionId: 'session-a' })
        expect(yield* Effect.flip(requests.complete({ requestId: pending?.requestId ?? '', reference: 'secret:SYNTHETIC_TOKEN@staging' }))).toMatchObject({
          reason: 'alias-missing',
        })
        yield* catalog.create({ alias: 'SYNTHETIC_TOKEN', scope: 'global', cwd: null, environment: 'staging', valueMode: 'manual', value: SYNTHETIC_VALUE })
        expect(yield* requests.complete({ requestId: pending?.requestId ?? '', reference: ' secret:SYNTHETIC_TOKEN@staging ' })).toEqual({
          reference: 'secret:SYNTHETIC_TOKEN@staging',
        })
        const outcome = yield* Fiber.join(asking)
        expect(outcome).toEqual({ status: 'stored', reference: 'secret:SYNTHETIC_TOKEN@staging' })
        expect(JSON.stringify(outcome)).not.toContain(SYNTHETIC_VALUE)
        expect(yield* requests.pending(null)).toEqual([])
        expect((yield* Effect.flip(requests.decline(pending?.requestId ?? ''))).reason).toBe('not-pending')
      }),
    ),
  )

  it.effect('refuses an answer that is not a reference', () =>
    withRequests(requests =>
      Effect.gen(function* () {
        yield* Effect.forkChild(requests.ask(input()))
        const [pending] = yield* awaitPending(requests, 1)
        expect(yield* Effect.flip(requests.complete({ requestId: pending?.requestId ?? '', reference: SYNTHETIC_VALUE }))).toMatchObject({
          reason: 'not-a-reference',
        })
      }),
    ),
  )

  it.effect('returns declined, expired and cancelled outcomes, and lists only the asking Session', () =>
    withRequests(requests =>
      Effect.gen(function* () {
        const declined = yield* Effect.forkChild(requests.ask(input()))
        const expiring = yield* Effect.forkChild(requests.ask(input({ sessionId: 'session-b', alias: 'OTHER', timeoutMs: 10_000 })))
        const cancelled = yield* Effect.forkChild(requests.ask(input({ alias: 'THIRD' })))
        yield* awaitPending(requests, 3)
        expect((yield* requests.pending('session-b')).map(view => view.alias)).toEqual(['OTHER'])
        const first = (yield* requests.pending('session-a')).find(view => view.alias === 'SYNTHETIC_TOKEN')
        yield* requests.decline(first?.requestId ?? '')
        expect(yield* Fiber.join(declined)).toEqual({ status: 'declined' })
        yield* TestClock.adjust(10_000)
        expect(yield* Fiber.join(expiring)).toEqual({ status: 'expired' })
        yield* Fiber.interrupt(cancelled)
        expect(Exit.hasInterrupts(yield* Fiber.await(cancelled))).toBe(true)
        expect(yield* requests.pending(null)).toEqual([])
      }),
    ),
  )

  it.effect('bounds the pending list and refuses a folder scope without a folder', () =>
    withRequests(requests =>
      Effect.gen(function* () {
        for (let index = 0; index < MAX_PENDING_SECRET_REQUESTS; index += 1) yield* Effect.forkChild(requests.ask(input({ alias: `A${String(index)}` })))
        yield* awaitPending(requests, MAX_PENDING_SECRET_REQUESTS)
        expect((yield* Effect.flip(requests.ask(input({ alias: 'OVERFLOW' })))).reason).toBe('too-many-pending')
        expect((yield* Effect.flip(requests.ask(input({ scope: 'project', cwd: null })))).reason).toBe('folder-required')
      }),
    ),
  )
})
