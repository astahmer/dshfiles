import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { ReplyRouting, threadWorthyQuestion } from './reply-routing.js'

describe('backlog reply routing', () => {
  it('routes work requests and keeps questions and discussion as replies with keyword fallback', () => {
    expect(ReplyRouting.keywords('Please fix the flaky test')).toMatchObject({ route: 'thread', source: 'keywords' })
    expect(ReplyRouting.keywords('Could you investigate this regression?')).toMatchObject({ route: 'thread', source: 'keywords' })
    expect(ReplyRouting.keywords('Why does this happen?')).toMatchObject({ route: 'reply', source: 'keywords' })
    expect(ReplyRouting.keywords('Thanks, that makes sense')).toMatchObject({ route: 'reply', source: 'keywords' })
  })

  it.effect('uses Jev confidence and sends the intended decision question', () =>
    Effect.gen(function* () {
      const asked: unknown[] = []
      const result = yield* ReplyRouting.classify({
        text: 'Fix the flaky test',
        jev: request => Effect.sync(() => asked.push(request.question)).pipe(Effect.as(0.86)),
      })
      expect(result).toMatchObject({ route: 'thread', source: 'jev', confidence: 0.86 })
      expect(asked).toEqual([threadWorthyQuestion])
    }),
  )

  it.effect('keeps low confidence as a reply and uses keywords when Jev fails', () =>
    Effect.gen(function* () {
      expect(yield* ReplyRouting.classify({ text: 'Could you explain this?', jev: () => Effect.succeed(0.42) })).toMatchObject({
        route: 'reply',
        source: 'jev',
      })
      expect(yield* ReplyRouting.classify({ text: 'Please fix this', jev: () => Effect.fail('offline') })).toMatchObject({
        route: 'thread',
        source: 'keywords',
      })
    }),
  )

  it.effect('honors a configured Jev threshold', () =>
    Effect.gen(function* () {
      expect(yield* ReplyRouting.classify({ text: 'Please fix this', jev: () => Effect.succeed(0.7), threshold: 0.8 })).toMatchObject({ route: 'reply' })
    }),
  )
})
