import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Exit, FiberHandle, Layer, Option, Stream, Tracer } from 'effect'
import { TracesSettingsService } from './settings.js'
import { EVENT_LOOP_STALL_SPAN } from './types.js'

/**
 * A 100 ms timer costs about 0.6 ms of CPU per second on an idle Node process (measured: 20 ms cost 2.3, 50 ms 1.2,
 * 250 ms 0.4). It catches every stall of `threshold + 100` ms and more, and a shorter one when it lands late in a tick.
 */
const PROBE_INTERVAL_MS = 100
const MAX_STALLS_PER_MINUTE = 30

export type EventLoopStall = {
  readonly startMs: number
  readonly endMs: number
  readonly stallMs: number
  readonly droppedBefore: number
}

/**
 * Timer drift: a tick that arrives `lateness` ms after it was due means the loop was blocked at least that long, ending
 * now. At most `maxPerMinute` stalls are reported per minute; the next reported one counts those dropped before it.
 */
const createStallDetector = (input: { readonly intervalMs: number; readonly thresholdMs: number; readonly maxPerMinute: number; readonly startMs: number }) => {
  let last = input.startMs
  let windowStart = input.startMs
  let reported = 0
  let dropped = 0
  return (nowMs: number): EventLoopStall | undefined => {
    const lateness = nowMs - last - input.intervalMs
    last = nowMs
    if (lateness < input.thresholdMs) return undefined
    if (nowMs - windowStart >= 60_000) {
      windowStart = nowMs
      reported = 0
    }
    if (reported >= input.maxPerMinute) {
      dropped++
      return undefined
    }
    reported++
    const droppedBefore = dropped
    dropped = 0
    return { startMs: nowMs - lateness, endMs: nowMs, stallMs: Math.round(lateness), droppedBefore }
  }
}

const nanosOf = (epochMs: number): bigint => BigInt(Math.round(epochMs * 1_000)) * 1_000n

/** A root span per stall, timed by the probe's clock rather than when the span object is made. */
const recordStall = (input: { readonly tracer: Tracer.Tracer; readonly stall: EventLoopStall; readonly thresholdMs: number }): void => {
  const span = input.tracer.span({
    name: EVENT_LOOP_STALL_SPAN,
    parent: Option.none(),
    annotations: Context.empty(),
    links: [],
    startTime: nanosOf(input.stall.startMs),
    kind: 'internal',
    root: true,
    sampled: true,
  })
  span.attribute('host.event_loop.stall_ms', input.stall.stallMs)
  span.attribute('host.event_loop.threshold_ms', input.thresholdMs)
  span.attribute('host.event_loop.probe_interval_ms', PROBE_INTERVAL_MS)
  if (input.stall.droppedBefore > 0) span.attribute('host.event_loop.stalls_dropped', input.stall.droppedBefore)
  span.end(nanosOf(input.stall.endMs), Exit.void)
}

const probe = (input: { readonly tracer: Tracer.Tracer; readonly thresholdMs: number }) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const origin = performance.timeOrigin
      const detect = createStallDetector({
        intervalMs: PROBE_INTERVAL_MS,
        thresholdMs: input.thresholdMs,
        maxPerMinute: MAX_STALLS_PER_MINUTE,
        startMs: origin + performance.now(),
      })
      const timer = setInterval(() => {
        const stall = detect(origin + performance.now())
        if (stall !== undefined) recordStall({ tracer: input.tracer, stall, thresholdMs: input.thresholdMs })
      }, PROBE_INTERVAL_MS)
      timer.unref()
      return timer
    }),
    timer => Effect.sync(() => clearInterval(timer)),
  ).pipe(Effect.andThen(Effect.never), Effect.scoped)

/** Runs the probe while `eventLoopStallMs` is above 0, restarting it when the threshold changes. */
const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* TracesSettingsService
    const tracer = yield* Effect.tracer
    const running = yield* FiberHandle.make()
    yield* DshxPlugin.worker(
      settings.changes.pipe(
        Stream.map(current => current.eventLoopStallMs),
        Stream.changes,
        Stream.runForEach(thresholdMs =>
          Effect.andThen(FiberHandle.clear(running), thresholdMs > 0 ? FiberHandle.run(running, probe({ tracer, thresholdMs })) : Effect.void),
        ),
      ),
    )
  }),
)

export class EventLoopStallMonitor {
  static readonly layer = layer
  static readonly createDetector = createStallDetector
  static readonly recordStall = recordStall
  static readonly probeIntervalMs = PROBE_INTERVAL_MS
}
