import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Duration, Effect, Layer, Schedule } from 'effect'
import { ALERT_INTERVAL_SECONDS, AlertEngine } from './alerts/alert-engine.js'
import { TracesSettingsModel, TracesSettingsService } from './settings.js'
import { TraceRepo } from './trace-repo.js'

const PRUNE_INTERVAL = Duration.minutes(10)
const FIRST_EVALUATION_DELAY = Duration.seconds(15)

/** Drops expired and excess telemetry every 10 minutes, on top of the prune each ingest already runs. */
export const RetentionWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const repo = yield* TraceRepo
    const settings = yield* TracesSettingsService
    const prune = Effect.flatMap(settings.get, current => repo.prune(TracesSettingsModel.retentionOf(current))).pipe(
      Effect.catchCause(cause => Effect.logWarning('trace retention prune failed', cause)),
      Effect.withTracerEnabled(false),
    )
    yield* DshxPlugin.worker(Effect.schedule(prune, Schedule.spaced(PRUNE_INTERVAL)))
  }),
)

/** Evaluates every enabled alert rule each minute, the first time 15 s after activation. */
export const AlertWorker = Layer.effectDiscard(
  Effect.gen(function* () {
    const engine = yield* AlertEngine
    const evaluate = engine.evaluate().pipe(Effect.catchCause(cause => Effect.logWarning('alert evaluation failed', cause)))
    yield* DshxPlugin.worker(
      Effect.andThen(Effect.sleep(FIRST_EVALUATION_DELAY), Effect.repeat(evaluate, Schedule.spaced(Duration.seconds(ALERT_INTERVAL_SECONDS)))),
    )
  }),
)
