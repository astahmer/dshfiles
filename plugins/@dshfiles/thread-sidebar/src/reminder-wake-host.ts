import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Clock, Context, Duration, Effect, Layer, Semaphore } from 'effect'
import type { HostCallFailed, SidebarSettingsWriteFailed } from './sidebar-errors.js'
import { ReminderWakeModel, type ScannedReminder } from './reminder-wake.js'
import { SidebarHost } from './sidebar-host-promise.js'
import { SidebarSettings } from './sidebar-settings.js'

/** What one wake pass reads from the Host. */
export interface ReminderWakeSnapshot {
  readonly reminders: readonly ScannedReminder[]
  readonly settledSessionIds: ReadonlySet<string>
  readonly archivedSessionIds: ReadonlySet<string>
}

/** The Host actions one wake pass takes; a settled status and an archived one are lifted by different owners. */
export class ReminderWakeSources extends Context.Service<
  ReminderWakeSources,
  {
    readonly snapshot: Effect.Effect<ReminderWakeSnapshot, HostCallFailed>
    readonly unsettle: (sessionIds: ReadonlyArray<string>) => Effect.Effect<void, SidebarSettingsWriteFailed>
    readonly restore: (sessionIds: ReadonlyArray<string>) => Effect.Effect<void, HostCallFailed>
    /** Deliver these reminders now: their occurrence passed while their thread could not run it. */
    readonly deliver: (reminders: ReadonlyArray<ScannedReminder>) => Effect.Effect<void>
  }
>()('@dshfiles/thread-sidebar/ReminderWakeSources') {
  static readonly layer = Layer.effect(
    ReminderWakeSources,
    Effect.gen(function* () {
      const host = yield* SidebarHost
      const settings = yield* SidebarSettings
      return ReminderWakeSources.of({
        snapshot: Effect.gen(function* () {
          return {
            reminders: yield* host.reminders,
            settledSessionIds: new Set(yield* settings.settledSessionIds),
            archivedSessionIds: new Set(yield* host.archivedSessionIds),
          }
        }),
        unsettle: sessionIds => settings.unsettle(sessionIds),
        // A failed restore or delivery retries on the next pass: the reminder is still overdue, or still waits
        // for the archived set to change.
        restore: sessionIds =>
          Effect.forEach(
            sessionIds,
            sessionId =>
              host
                .unarchiveSession(sessionId)
                .pipe(Effect.catch(error => Effect.logWarning(`thread-sidebar: could not restore ${sessionId} for its reminder`, error))),
            { concurrency: 2, discard: true },
          ),
        deliver: reminders =>
          Effect.forEach(
            reminders,
            reminder =>
              host.runReminder(reminder.id).pipe(Effect.catch(error => Effect.logWarning(`thread-sidebar: could not run reminder ${reminder.id}`, error))),
            { concurrency: 2, discard: true },
          ),
      })
    }),
  )
}

/** The Host waits this long after boot so the session controller and the Schedule service finish activating. */
export const REMINDER_WAKE_BOOT_DELAY = Duration.seconds(30)

/** One pass per minute: a reminder due in that window finds its thread awake instead of stored away. */
export const REMINDER_WAKE_INTERVAL = Duration.minutes(1)

export const REMINDER_WAKE_AHEAD_MS = Duration.toMillis(REMINDER_WAKE_INTERVAL)

/**
 * Lifts the settled and archived status of a thread whose reminder is due, so the reminder always runs. The
 * settled pre-step gate and the native archived gate both reject a reminder's step, and the Schedule service
 * refuses an archived target, so this pass runs ahead of the delivery rather than after it was refused.
 */
export class ReminderWake extends Context.Service<
  ReminderWake,
  {
    readonly wake: Effect.Effect<void>
  }
>()('@dshfiles/thread-sidebar/ReminderWake') {
  static readonly layer = Layer.effect(
    ReminderWake,
    Effect.gen(function* () {
      const sources = yield* ReminderWakeSources
      const settings = yield* SidebarSettings
      const running = yield* Semaphore.make(1)
      const wake = Effect.gen(function* () {
        if (!(yield* settings.remindersWake)) return
        const snapshot = yield* sources.snapshot
        const now = yield* Clock.currentTimeMillis
        const plan = ReminderWakeModel.plan({ ...snapshot, now, aheadMs: REMINDER_WAKE_AHEAD_MS })
        yield* Effect.annotateCurrentSpan({
          'thread_sidebar.reminders.unsettled': plan.unsettle.length,
          'thread_sidebar.reminders.restored': plan.restore.length,
          'thread_sidebar.reminders.delivered': plan.deliver.length,
        })
        if (plan.unsettle.length > 0) yield* sources.unsettle(plan.unsettle)
        if (plan.restore.length > 0) yield* sources.restore(plan.restore)
        if (plan.deliver.length > 0) yield* sources.deliver(plan.deliver)
      }).pipe(Effect.withSpan('reminder wake', { attributes: { 'dshx.plugin.package': '@dshfiles/thread-sidebar' } }))
      return ReminderWake.of({
        // One pass at a time, and a failed pass retries on the next one: the Schedule service owns its own
        // delivery errors, and the next pass sees the same overdue reminder again.
        wake: running.withPermits(1)(
          wake.pipe(Effect.catch(error => Effect.logWarning('thread-sidebar: reminder wake failed and retries on the next pass', error))),
        ),
      })
    }),
  )

  /** Wake once after boot, then once per pass. */
  static readonly schedule = (bootDelay: Duration.Duration = REMINDER_WAKE_BOOT_DELAY) =>
    Layer.effectDiscard(
      Effect.gen(function* () {
        const wake = yield* ReminderWake
        yield* DshxPlugin.worker(
          Effect.gen(function* () {
            yield* Effect.sleep(bootDelay)
            for (;;) {
              yield* wake.wake
              yield* Effect.sleep(REMINDER_WAKE_INTERVAL)
            }
          }),
        )
      }),
    )
}
