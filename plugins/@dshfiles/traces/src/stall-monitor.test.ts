import { DshxEffect } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { recordSpans, type SpanRecorder } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import type { NormalizedSpan } from './otlp/normalize.js'
import { ReceiverHarness } from './receiver.test-support.js'
import { tracesSettings } from './settings.js'
import { EventLoopStallMonitor } from './stall-monitor.js'
import { TraceRepoTest } from './test-layers.test-support.js'
import { TraceRepo } from './trace-repo.js'
import { EVENT_LOOP_STALL_SPAN } from './types.js'

const stopRecording = (recorder: SpanRecorder) => Effect.sync(() => recorder.stop())

const blockFor = (ms: number) =>
  Effect.sync(() => {
    const until = performance.now() + ms
    while (performance.now() < until);
  })

const monitorWith = (eventLoopStallMs: number) =>
  EventLoopStallMonitor.layer.pipe(
    Layer.provide(Settings.layerTest(tracesSettings.namespace, { ...ReceiverHarness.defaultSettings, eventLoopStallMs })),
    Layer.provide(DshxEffect.tracerLayer),
  )

describe('event-loop stall monitor', () => {
  it('reports a tick that arrives at least the threshold late, as a stall ending now', () => {
    const detect = EventLoopStallMonitor.createDetector({ intervalMs: 100, thresholdMs: 100, maxPerMinute: 30, startMs: 0 })
    expect(detect(100)).toBeUndefined()
    expect(detect(299)).toBeUndefined()
    expect(detect(650)).toEqual({ startMs: 399, endMs: 650, stallMs: 251, droppedBefore: 0 })
  })

  it('reports at most maxPerMinute stalls a minute and counts the dropped ones on the next', () => {
    const detect = EventLoopStallMonitor.createDetector({ intervalMs: 100, thresholdMs: 100, maxPerMinute: 2, startMs: 0 })
    expect(detect(300)?.stallMs).toBe(200)
    expect(detect(600)?.stallMs).toBe(200)
    expect(detect(900)).toBeUndefined()
    expect(detect(1_200)).toBeUndefined()
    expect(detect(61_000)).toEqual({ startMs: 1_300, endMs: 61_000, stallMs: 59_700, droppedBefore: 2 })
  })

  it.live('records a host event-loop stall span when the loop is blocked past the threshold', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        stopRecording,
      )
      yield* Effect.gen(function* () {
        yield* Effect.sleep('300 millis')
        yield* blockFor(350)
        yield* Effect.sleep('150 millis')
      }).pipe(Effect.provide(monitorWith(100)))

      // A loaded machine can add stalls of its own; the blocked 350 ms is the longest one.
      const stalls = recorder.named('host event-loop stall')
      const stall = stalls.reduce((longest, next) =>
        Number(next.attributes['host.event_loop.stall_ms']) > Number(longest.attributes['host.event_loop.stall_ms']) ? next : longest,
      )
      expect(stall.parentSpanId).toBeUndefined()
      expect(stall.attributes['host.event_loop.stall_ms']).toBeGreaterThanOrEqual(240)
      expect(stall.attributes['host.event_loop.threshold_ms']).toBe(100)
      const durationMs = Number(stall.endTimeUnixNano - stall.startTimeUnixNano) / 1e6
      expect(Math.abs(durationMs - Number(stall.attributes['host.event_loop.stall_ms']))).toBeLessThan(2)
    }),
  )

  it.live('records nothing with the threshold at 0', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        stopRecording,
      )
      yield* Effect.andThen(blockFor(250), Effect.sleep('150 millis')).pipe(Effect.provide(monitorWith(0)))
      expect(recorder.named(EVENT_LOOP_STALL_SPAN)).toEqual([])
    }),
  )
})

const MS = 1_000
const at = (ms: number) => (1_700_000_000_000 + ms) * MS

const span = (input: {
  readonly id: string
  readonly name: string
  readonly startMs: number
  readonly endMs: number
  readonly attributes?: NormalizedSpan['attributes']
}): NormalizedSpan => ({
  traceId: input.id.padStart(32, '0'),
  spanId: input.id.padStart(16, '0'),
  parentSpanId: null,
  name: input.name,
  service: 'dshfiles',
  scope: null,
  kind: 1,
  startUs: at(input.startMs),
  endUs: at(input.endMs),
  statusCode: 0,
  statusMessage: null,
  sessionId: null,
  attributes: input.attributes ?? {},
  resource: {},
  events: [],
  linkCount: 0,
})

describe('stored stalls', () => {
  it.live('lists a stall with the spans open during it, the one it fills most first, and leaves out spans outside it', () =>
    Effect.gen(function* () {
      const repo = yield* TraceRepo
      const now = Date.now() - 1_700_000_000_000 - 5_000
      yield* repo.ingestSpans(
        [
          span({ id: 'a1', name: EVENT_LOOP_STALL_SPAN, startMs: now, endMs: now + 300, attributes: { 'host.event_loop.stall_ms': 300 } }),
          span({ id: 'b1', name: 'invoke_agent coder', startMs: now - 60_000, endMs: now + 9_000 }),
          span({ id: 'c1', name: 'sqlite lock wait', startMs: now - 5, endMs: now + 290 }),
          span({ id: 'd1', name: 'usage index', startMs: now + 100, endMs: now + 200 }),
          span({ id: 'e1', name: 'before the stall', startMs: now - 500, endMs: now - 10 }),
        ],
        { maxAgeHours: 72, maxSpans: 100_000, maxLogs: 100_000, maxMetricPoints: 100_000 },
      )

      const stalls = yield* repo.stalls({ windowMinutes: 60, limit: 20 })

      expect(stalls).toHaveLength(1)
      expect(stalls[0]?.stallMs).toBe(300)
      expect(stalls[0]?.overlapping.map(entry => entry.name)).toEqual(['sqlite lock wait', 'usage index', 'invoke_agent coder'])
      expect(stalls[0]?.overlapping[0]?.overlapMs).toBe(290)
    }).pipe(Effect.provide(TraceRepoTest)),
  )
})
