import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

describe('pulls-review Effect spans', () => {
  it('records review and summary spans through the dshx tracer bridge', async () => {
    using recorder = recordSpans()
    const review = Effect.fn('pulls-review review')(function* () {
      return yield* Effect.succeed('reviewed')
    })
    const summarize = Effect.fn('pulls-review summarize')(function* () {
      return yield* Effect.succeed('summarized')
    })

    await expect(Effect.runPromise(review().pipe(Effect.provide(DshxEffect.tracerLayer)))).resolves.toBe('reviewed')
    await expect(Effect.runPromise(summarize().pipe(Effect.provide(DshxEffect.tracerLayer)))).resolves.toBe('summarized')

    expect(recorder.span('pulls-review review').status.code).toBe('unset')
    expect(recorder.span('pulls-review summarize').status.code).toBe('unset')
  })
})
