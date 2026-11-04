import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Fiber, Ref, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { StorageDomainOpenFailed, acquireSharedHandle, openWaitingForClose } from '../src/effect/storage-domain.js'

/** An open that fails with `code` for its first `failures` attempts, then returns the attempt number. */
const flakyOpen = (attempts: Ref.Ref<number>, failures: number, code: StorageDomainOpenFailed['code']) =>
  Ref.updateAndGet(attempts, count => count + 1).pipe(
    Effect.flatMap(attempt => (attempt <= failures ? Effect.fail(new StorageDomainOpenFailed({ domain: 'thread_attention', code })) : Effect.succeed(attempt))),
  )

describe('StorageDomain open after a reload', () => {
  it.effect('waits for the previous instance to close the domain, then opens it', () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const fiber = yield* Effect.forkChild(openWaitingForClose(flakyOpen(attempts, 3, 'already-open')))
      yield* TestClock.adjust('1 second')
      expect(yield* Fiber.join(fiber)).toBe(4)
    }),
  )

  it.effect('does not retry any other open failure', () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const exit = yield* Effect.exit(openWaitingForClose(flakyOpen(attempts, 1, 'facet-unsupported')))
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* Ref.get(attempts)).toBe(1)
    }),
  )

  it.effect('still fails a domain that stays open elsewhere, after a bounded wait', () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      const fiber = yield* Effect.forkChild(Effect.exit(openWaitingForClose(flakyOpen(attempts, Number.POSITIVE_INFINITY, 'already-open'))))
      yield* TestClock.adjust('10 seconds')
      const exit = yield* Fiber.join(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(yield* Ref.get(attempts)).toBe(101)
    }),
  )
})

/** A fake facility: one reserved name, refusing a second open until the first handle closes, like the native one. */
const fakeFacility = () => {
  const state = { open: undefined as { readonly id: number } | undefined, opens: 0, closes: 0 }
  return {
    state,
    open: Effect.suspend(() => {
      if (state.open !== undefined) return Effect.fail(new StorageDomainOpenFailed({ domain: 'thread_attention', code: 'already-open' }))
      state.opens += 1
      state.open = { id: state.opens }
      return Effect.succeed(state.open)
    }),
    close: (handle: { readonly id: number }) =>
      Effect.sync(() => {
        state.closes += 1
        if (state.open === handle) state.open = undefined
      }),
  }
}

describe('StorageDomain shared handles across a plugin reload', () => {
  it.effect('lets the reloaded instance reuse the open domain and closes it with the last holder', () =>
    Effect.gen(function* () {
      const facility = fakeFacility()
      const acquire = (key: string, holder: string, fingerprint = 'v1') =>
        acquireSharedHandle({ key, holder, fingerprint, isLive: handle => facility.state.open === handle, open: facility.open, close: facility.close })
      const oldScope = yield* Scope.make()
      const newScope = yield* Scope.make()
      const oldHandle = yield* Scope.provide(oldScope)(acquire('@test/reload\u0000thread_attention', 'old activation'))
      // The rebuilt instance activates before the old one is disposed: it gets the same handle instead of already-open.
      const newHandle = yield* Scope.provide(newScope)(acquire('@test/reload\u0000thread_attention', 'new activation'))
      expect(newHandle).toBe(oldHandle)
      // One activation opening the same domain twice is still a bug, and still fails loud.
      const twice = yield* Effect.exit(Scope.provide(newScope)(acquire('@test/reload\u0000thread_attention', 'new activation')))
      expect(Exit.isFailure(twice)).toBe(true)
      yield* Scope.close(oldScope, Exit.void)
      expect(facility.state.closes).toBe(0)
      yield* Scope.close(newScope, Exit.void)
      expect(facility.state).toMatchObject({ opens: 1, closes: 1, open: undefined })
    }),
  )

  it.effect('opens a fresh handle when the old one is no longer live', () =>
    Effect.gen(function* () {
      const facility = fakeFacility()
      const acquire = () =>
        acquireSharedHandle({ key: '@test/stale\u0000domain', holder: Symbol('activation'), fingerprint: 'v1', isLive: handle => facility.state.open === handle, open: facility.open, close: facility.close })
      const first = yield* Scope.make()
      const handle = yield* Scope.provide(first)(acquire())
      facility.state.open = undefined // the facility itself was reloaded and closed every domain
      const second = yield* Scope.make()
      const fresh = yield* Scope.provide(second)(acquire())
      expect(fresh).not.toBe(handle)
      expect(facility.state.opens).toBe(2)
      yield* Scope.close(first, Exit.void)
      yield* Scope.close(second, Exit.void)
    }),
  )

  it.effect('does not share a handle opened with a different table set', () =>
    Effect.gen(function* () {
      const facility = fakeFacility()
      const acquire = (fingerprint: string) =>
        acquireSharedHandle({ key: '@test/spec\u0000domain', holder: Symbol(fingerprint), fingerprint, isLive: handle => facility.state.open === handle, open: facility.open, close: facility.close })
      const scope = yield* Scope.make()
      yield* Scope.provide(scope)(acquire('v1'))
      const fiber = yield* Effect.forkChild(Effect.exit(Scope.provide(scope)(acquire('v2'))))
      yield* TestClock.adjust('10 seconds')
      expect(Exit.isFailure(yield* Fiber.join(fiber))).toBe(true)
      yield* Scope.close(scope, Exit.void)
    }),
  )
})
