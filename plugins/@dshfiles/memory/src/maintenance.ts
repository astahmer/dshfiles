import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Effect, Layer, Schedule } from 'effect'

import { Digester } from './digester.ts'
import { MemorySettingsTag } from './embedder.ts'
import { MemoryRepo } from './memory-repo.ts'

/** Startup catch-up waits until the Host settles, so it never competes with the first turns after a restart. */
const catchUpAfter = '30 seconds'
const catchUpLimit = 25

/** Retention once a day, plus one bounded catch-up of Sessions memory never digested, 30 s after activation. */
export const Maintenance = Layer.effectDiscard(
  Effect.gen(function* () {
    const repo = yield* MemoryRepo
    const settings = yield* MemorySettingsTag
    const digester = yield* Digester

    const retention = Effect.gen(function* () {
      const pruned = yield* repo.prune((yield* settings.get).retentionDays)
      if (pruned.threads + pruned.messages > 0)
        yield* Effect.logInfo(`memory: retention dropped ${pruned.threads} digest(s) and ${pruned.messages} indexed message(s)`)
    }).pipe(
      Effect.catchCause(cause => Effect.logWarning('memory: retention pass failed', cause)),
      Effect.withSpan('memory retention pass'),
    )

    const catchUp = digester.catchUp(catchUpLimit).pipe(
      Effect.tap(count => (count > 0 ? Effect.logInfo(`memory: caught up ${count} earlier session(s)`) : Effect.void)),
      Effect.catchCause(cause => Effect.logWarning('memory: catch-up failed', cause)),
    )

    yield* DshxPlugin.worker(Effect.sleep(catchUpAfter).pipe(Effect.andThen(retention), Effect.andThen(catchUp)))
    yield* DshxPlugin.worker(Effect.schedule(retention, Schedule.spaced('1 day')))
  }),
)
