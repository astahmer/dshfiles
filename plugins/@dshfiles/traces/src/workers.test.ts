import { Settings } from '@dshfiles/dshx/effect/settings'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { AlertEngine, RunningSessions, ThreadAttention } from './alerts/alert-engine.js'
import type { NormalizedSpan } from './otlp/normalize.js'
import { ReceiverHarness } from './receiver.test-support.js'
import { tracesSettings } from './settings.js'
import { AlertRepoTest, TraceRepoTest } from './test-layers.test-support.js'
import { TraceRepo } from './trace-repo.js'
import { AlertWorker, RetentionWorker } from './workers.js'

const START = 1_700_000_000_000

const span: NormalizedSpan = {
  traceId: '1'.padStart(32, '0'),
  spanId: '1'.padStart(16, '0'),
  parentSpanId: null,
  name: 'op',
  service: 'svc',
  scope: null,
  kind: 1,
  startUs: START * 1000,
  endUs: START * 1000 + 1_000,
  statusCode: 0,
  statusMessage: null,
  sessionId: null,
  attributes: {},
  resource: {},
  events: [],
  linkCount: 0,
}

const edges = Layer.mergeAll(
  Layer.succeed(ThreadAttention, ThreadAttention.of({ mark: () => Effect.succeed(true) })),
  Layer.succeed(RunningSessions, RunningSessions.of({ ids: Effect.succeed(new Set<string>()) })),
)

const services = Layer.mergeAll(TraceRepoTest, AlertRepoTest, edges, Settings.layerTest(tracesSettings.namespace, ReceiverHarness.defaultSettings))
const engine = AlertEngine.layer.pipe(Layer.provideMerge(services))

describe('background workers', () => {
  it.effect('evaluates alerts 15 s after activation, then every minute', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(START)
      yield* Effect.gen(function* () {
        const alerts = yield* AlertEngine
        const lastEvaluated = Effect.map(alerts.snapshot({ historyLimit: 0 }), snapshot => snapshot.lastEvaluatedAt)
        yield* TestClock.adjust(14_999)
        expect(yield* lastEvaluated).toBeNull()
        yield* TestClock.adjust(1)
        expect(yield* lastEvaluated).toBe(START + 15_000)
        yield* TestClock.adjust(60_000)
        expect(yield* lastEvaluated).toBe(START + 75_000)
      }).pipe(Effect.provide(AlertWorker.pipe(Layer.provideMerge(engine))))
    }),
  )

  it.effect('prunes expired telemetry on its 10-minute tick', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(START)
      yield* Effect.gen(function* () {
        const repo = yield* TraceRepo
        yield* repo.ingestSpans([span], { maxAgeHours: 1, maxSpans: 100_000, maxLogs: 100_000, maxMetricPoints: 200_000 })
        yield* TestClock.adjust(69 * 60_000)
        expect((yield* repo.summary()).traces).toBe(1)
        yield* TestClock.adjust(60_000)
        expect((yield* repo.summary()).traces).toBe(0)
      }).pipe(
        Effect.provide(
          RetentionWorker.pipe(
            Layer.provideMerge(
              Layer.mergeAll(TraceRepoTest, Settings.layerTest(tracesSettings.namespace, { ...ReceiverHarness.defaultSettings, retentionHours: 1 })),
            ),
          ),
        ),
      )
    }),
  )
})
