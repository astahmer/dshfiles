import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Scope } from 'effect'
import { TestClock } from 'effect/testing'
import { restartExitGuard } from './restart-exit-guard.js'

describe('restart exit guard', () => {
  it.effect('forces the restart exit code after the grace and names what still holds the Host', () =>
    Effect.gen(function* () {
      const exits: number[] = []
      const lines: string[] = []
      yield* restartExitGuard({
        code: 75,
        exit: code => void exits.push(code),
        write: line => void lines.push(line),
        activeResources: () => ['Timeout', 'PipeWrap', 'Timeout'],
      })
      yield* TestClock.adjust('9 seconds')
      expect(exits).toEqual([])
      yield* TestClock.adjust('1 second')
      expect(exits).toEqual([75])
      expect(lines).toEqual([
        '[thread-sidebar] restart: DSH was still running 10 s after it was asked to exit (still open: Timeout, PipeWrap); forcing exit 75 so the supervisor starts the new Host.',
      ])
    }),
  )

  it.effect('outlives the plugin scope that armed it, so plugin disposal cannot cancel the exit', () =>
    Effect.gen(function* () {
      const exits: number[] = []
      const scope = yield* Scope.make()
      yield* restartExitGuard({ code: 75, exit: code => void exits.push(code), write: () => undefined }).pipe(Scope.provide(scope))
      yield* Scope.close(scope, Exit.void)
      yield* TestClock.adjust('10 seconds')
      expect(exits).toEqual([75])
    }),
  )
})
