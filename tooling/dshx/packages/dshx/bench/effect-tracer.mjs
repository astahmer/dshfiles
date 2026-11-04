// Per-primitive cost of the dshx Effect tracer's `context` hook: 300k flatMap steps, scenarios interleaved, min of 30 rounds.
// Run after `pnpm exec turbo run build --filter=@dshfiles/dshx`: node bench/effect-tracer.mjs
import { Effect, Tracer } from 'effect'
import { tracerLayer } from '../dist/effect/tracer.js'
import { recordSpans } from '../dist/tracing/index.js'

const STEPS = 300_000
const ROUNDS = 30

const steps = remaining => (remaining === 0 ? Effect.void : Effect.flatMap(Effect.void, () => steps(remaining - 1)))
const dshxTracer = Effect.runSync(Effect.tracer.pipe(Effect.provide(tracerLayer)))
const withTracer = effect => Effect.provideService(effect, Tracer.Tracer, dshxTracer)

const timed = run => {
  const started = performance.now()
  run()
  return performance.now() - started
}

const scenarios = {
  'no tracer': () => Effect.runSync(steps(STEPS)),
  'dshx tracer, no span': () => Effect.runSync(withTracer(steps(STEPS))),
  'dshx tracer, span, recording off': () => Effect.runSync(withTracer(steps(STEPS).pipe(Effect.withSpan('bench')))),
  'dshx tracer, span, recording on': () => {
    const recorder = recordSpans()
    try {
      Effect.runSync(withTracer(steps(STEPS).pipe(Effect.withSpan('bench'))))
    } finally {
      recorder.stop()
    }
  },
}

const results = Object.fromEntries(Object.keys(scenarios).map(name => [name, Number.POSITIVE_INFINITY]))
for (let round = 0; round < ROUNDS; round += 1) {
  for (const [name, run] of Object.entries(scenarios)) results[name] = Math.min(results[name], timed(run))
}
const baseline = results['no tracer']
console.log(`node ${process.version}, ${STEPS} flatMap steps, min of ${ROUNDS} interleaved rounds`)
for (const [name, milliseconds] of Object.entries(results)) {
  const overhead = ((milliseconds - baseline) * 1e6) / STEPS
  console.log(`${name.padEnd(36)} ${milliseconds.toFixed(1).padStart(7)} ms  ${overhead >= 0 ? '+' : ''}${overhead.toFixed(0)} ns/step`)
}
