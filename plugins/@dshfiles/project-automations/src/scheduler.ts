import { Clock, Duration, Effect, Queue, Stream } from 'effect'
import type { AutomationRecord, RunRecord } from './automations-api.js'
import { AutomationStore } from './automation-store.js'
import { AutomationRunner } from './automation-runner.js'
import { ScheduleModel } from './schedule.js'

/** The loop sleeps at most this long, so a clock jump or a missed wake-up is caught within a minute. */
const MAX_SLEEP_MS = 60_000

type ScheduleTrigger = Extract<AutomationRecord['trigger'], { readonly kind: 'schedule' }>
const scheduleOf = (record: AutomationRecord): ScheduleTrigger | undefined => (record.trigger.kind === 'schedule' ? record.trigger : undefined)

/**
 * Run every enabled schedule whose committed target is due at `now`. Each due automation first commits its next
 * target (so a crash cannot run it twice), then starts one thread for the latest missed occurrence: a Host that was
 * down across several targets catches up once, as DSH reminders do.
 */
export const tick = Effect.fn('automation schedule tick')(function* (now: number) {
  const store = yield* AutomationStore
  const runner = yield* AutomationRunner
  const due = yield* store.exclusive(
    Effect.gen(function* () {
      const accepted: { readonly automation: AutomationRecord; readonly occurrenceAt: string }[] = []
      for (const record of yield* store.automations) {
        const schedule = scheduleOf(record)
        if (!record.enabled || schedule === undefined || schedule.nextRunAt === null) continue
        const decision = ScheduleModel.due(schedule.timing, schedule.nextRunAt, now)
        if (decision === undefined) continue
        const next: AutomationRecord = { ...record, trigger: { ...schedule, nextRunAt: decision.nextRunAt } }
        yield* store.put(next)
        accepted.push({ automation: next, occurrenceAt: decision.occurrenceAt })
      }
      return accepted
    }),
  )
  // One at a time: each run is a thread start, and a burst after downtime should not open them all at once.
  const runs: readonly RunRecord[] = yield* Effect.forEach(due, item =>
    runner.start({ automation: item.automation, trigger: 'schedule', prompt: item.automation.prompt, occurrenceAt: item.occurrenceAt }),
  )
  return runs
})

/** Milliseconds until the earliest enabled schedule target, capped at MAX_SLEEP_MS. */
const untilNext = Effect.fn('automation schedule next')(function* (now: number) {
  const store = yield* AutomationStore
  let wait = MAX_SLEEP_MS
  for (const record of yield* store.automations) {
    const schedule = scheduleOf(record)
    if (!record.enabled || schedule?.nextRunAt == null) continue
    wait = Math.min(wait, Math.max(0, Date.parse(schedule.nextRunAt) - now))
  }
  return wait
})

/**
 * The plugin's `main`: tick, then sleep until the next target or until an automation record changes (an edit, a
 * pause, a browser write), whichever comes first. A failed tick is logged and retried on the next wake.
 */
export const runScheduler = Effect.gen(function* () {
  const store = yield* AutomationStore
  const wake = yield* Queue.sliding<void>(1)
  yield* Effect.forkScoped(Stream.runForEach(store.changes, () => Queue.offer(wake, undefined)))
  for (;;) {
    const now = yield* Clock.currentTimeMillis
    yield* tick(now).pipe(Effect.catchCause(cause => Effect.logWarning('project-automations: schedule tick failed', cause)))
    const wait = yield* untilNext(yield* Clock.currentTimeMillis).pipe(Effect.orElseSucceed(() => MAX_SLEEP_MS))
    // A target due right now still yields once, so a record that cannot advance never spins the loop.
    yield* Effect.raceFirst(Effect.sleep(Duration.millis(Math.max(wait, 250))), Queue.take(wake))
    // Let a burst of writes (an edit commits several keys) settle into one tick.
    yield* Effect.sleep(Duration.millis(50))
  }
})
