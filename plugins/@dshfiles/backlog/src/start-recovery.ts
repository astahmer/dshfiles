import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Cause, Clock, Context, Effect, Layer, Schedule } from 'effect'
import { StartIntentClaims, StartIntents, type StartIntent } from './start-intents.js'
import { BacklogStore } from './store.js'
import { ThreadStart } from './thread-start.js'

/** How long a recorded start may sit without a refresh before a recovery pass takes it: a live start touches every step. */
const STALE_MS = 45_000

/** How many owed starts one pass finishes, so a recovery sweep never floods the Host with thread creations. */
const SWEEP_LIMIT = 5

/** Attempts (and age) after which a start that keeps failing is handed back to the person instead of retried forever. */
const MAX_ATTEMPTS = 3
const MAX_AGE_MS = 10 * 60_000

const FIRST_SWEEP = '10 seconds'
const SWEEP_INTERVAL = '20 seconds'

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Finishes the thread starts a Host death interrupted. The start log is written before a Session exists and cleared once
 * the thread is prompted and linked, so any row left behind is work the user already asked for: the sweep reuses the
 * Session that start created, prompts it only when it never received its message, links the items and clears the row.
 * A start that keeps failing becomes a comment and a `blocked` flag on its item, with the retry the person should take.
 */
export class StartRecovery extends Context.Service<StartRecovery, { readonly sweep: Effect.Effect<number> }>()('@dshfiles/backlog/StartRecovery') {
  static readonly layer = Layer.effect(
    StartRecovery,
    Effect.gen(function* () {
      const threads = yield* ThreadStart
      const intents = yield* StartIntents
      const claims = yield* StartIntentClaims
      const store = yield* BacklogStore

      const forget = (id: string) =>
        intents.remove(id).pipe(Effect.catch(error => Effect.logWarning('backlog: a recovered thread start was not cleared from the recovery log', error)))

      /** Tells the person, on the item itself, that the thread they asked for never started and how to ask again. */
      const report = Effect.fn('backlog start recovery report')(function* (intent: StartIntent, reason: string) {
        const { items } = yield* store.getMany(intent.itemIds)
        const handle = intent.agent
        const message =
          handle === null
            ? `The thread this comment asked for never started: ${reason} Reply here to start it again.`
            : `The thread @${handle} should have started never did: ${reason} Reply here with @${handle} to start it again.`
        for (const detail of items) {
          yield* store
            .comment({ id: detail.item.id, text: message, actor: { kind: 'system' } })
            .pipe(Effect.catch(error => Effect.logWarning('backlog: a failed thread start was not reported on its item', error)))
          yield* store
            .update({ id: detail.item.id, attention: 'blocked', actor: { kind: 'system' } })
            .pipe(Effect.catch(error => Effect.logWarning('backlog: a failed thread start left its item unflagged', error)))
        }
      })

      const resumeOne = Effect.fn('backlog start recovery resume')(function* (intent: StartIntent) {
        const outcome = yield* threads.resume(intent).pipe(Effect.result)
        if (outcome._tag === 'Success' && outcome.success.linked.length === intent.itemIds.length) {
          yield* forget(intent.id)
          return true
        }
        const now = yield* Clock.currentTimeMillis
        const attempts = intent.attempts + 1
        const reason =
          outcome._tag === 'Failure'
            ? reasonOf(outcome.failure)
            : `the thread started but only ${String(outcome.success.linked.length)} of ${String(intent.itemIds.length)} items were linked`
        if (attempts >= MAX_ATTEMPTS || now - intent.createdAt > MAX_AGE_MS) {
          yield* report(intent, reason)
          yield* forget(intent.id)
          return false
        }
        yield* intents
          .attempted({ id: intent.id, attempts, lastError: reason, now })
          .pipe(Effect.catch(error => Effect.logWarning('backlog: a retried thread start was not recorded', error)))
        return false
      })

      const sweepOnce = Effect.fn('backlog start recovery')(function* () {
        const now = yield* Clock.currentTimeMillis
        const stale = yield* intents.stale({ before: now - STALE_MS, limit: SWEEP_LIMIT })
        if (stale.length === 0) return 0
        yield* Effect.annotateCurrentSpan({ 'dshx.backlog.start_intents': stale.length })
        const resumed: boolean[] = []
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- one resume per owed start, each creating a thread.
        for (const intent of stale) {
          if (yield* claims.held(intent.id)) continue
          resumed.push(yield* resumeOne(intent))
        }
        return resumed.filter(Boolean).length
      })

      const sweep = sweepOnce().pipe(Effect.catch(error => Effect.as(Effect.logWarning('backlog: the thread start recovery pass failed', error), 0)))

      return StartRecovery.of({ sweep })
    }),
  )

  /** The loop the plugin runs: the first pass shortly after boot, then one pass every interval. */
  static readonly loop = Layer.effectDiscard(
    Effect.gen(function* () {
      const recovery = yield* StartRecovery
      const tick = recovery.sweep.pipe(
        Effect.catchCause(cause =>
          Cause.hasInterruptsOnly(cause) ? Effect.failCause(cause) : Effect.logWarning('backlog: the thread start recovery loop failed', cause),
        ),
      )
      yield* DshxPlugin.worker(Effect.sleep(FIRST_SWEEP).pipe(Effect.andThen(Effect.repeat(tick, Schedule.spaced(SWEEP_INTERVAL)))))
    }),
  )
}
