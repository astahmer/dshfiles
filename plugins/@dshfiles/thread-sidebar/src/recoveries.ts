import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Clock, Context, Duration, Effect, Layer } from 'effect'
import { InflightTurns } from './inflight-turns.js'
import { RecoveryStore, type RestartRecoveryEntry } from './restart-recovery.js'
import type { HostCallFailed, HostCapabilityMissing, RuntimeStateFailed, RuntimeStateInvalid } from './sidebar-errors.js'
import { SidebarHost } from './sidebar-host-promise.js'
import { SidebarSettings } from './sidebar-settings.js'

const resumePrompt = [
  'Your previous turn was interrupted while DSH was restarting.',
  'Continue from the persisted transcript and current workspace state.',
  'First inspect the last assistant and tool events and verify the current state of the workspace.',
  'Do not repeat or assume success for any tool action whose result is missing; verify its effects before taking further action.',
  'If safe continuation is unclear, explain what needs human input instead of guessing.',
].join(' ')

/** Rows recorded this long before boot belong to the stop that just happened; older ones wait for a person. */
const AUTO_RESUME_WINDOW = Duration.minutes(30)
/** Lets the session controller and providers finish activating before the first resumed turn starts. */
const AUTO_RESUME_DELAY = '10 seconds'

type StateError = RuntimeStateFailed | RuntimeStateInvalid

/** Threads a restart or a crash interrupted: list them, resume one with the fixed continuation prompt, or dismiss it. */
export class Recoveries extends Context.Service<
  Recoveries,
  {
    readonly pending: Effect.Effect<ReadonlyArray<RestartRecoveryEntry>, StateError>
    /** Queue the continuation prompt once: its stable request id makes a repeat a no-op. False when nothing waits. */
    readonly resume: (sessionId: string) => Effect.Effect<boolean, StateError | HostCapabilityMissing | HostCallFailed>
    readonly dismiss: (sessionId: string) => Effect.Effect<boolean, StateError>
  }
>()('@dshfiles/thread-sidebar/Recoveries') {
  static readonly layer = Layer.effect(
    Recoveries,
    Effect.gen(function* () {
      const store = yield* RecoveryStore
      const host = yield* SidebarHost
      const entryOf = (sessionId: string) => Effect.map(store.list, entries => entries.find(candidate => candidate.sessionId === sessionId))
      return Recoveries.of({
        pending: Effect.gen(function* () {
          yield* store.remove(new Set(yield* host.runningSessionIds))
          return yield* store.list
        }).pipe(Effect.withSpan('recoveries pending')),
        resume: Effect.fn('recoveries resume')(function* (sessionId) {
          const entry = yield* entryOf(sessionId)
          if (entry === undefined) return false
          if (!(yield* host.runningSessionIds).includes(sessionId)) yield* host.queuePrompt({ requestId: entry.requestId, sessionId, text: resumePrompt })
          yield* store.remove(new Set([sessionId]))
          return true
        }),
        dismiss: Effect.fn('recoveries dismiss')(function* (sessionId) {
          const exists = (yield* entryOf(sessionId)) !== undefined
          yield* store.remove(new Set([sessionId]))
          return exists
        }),
      })
    }),
  )
}

/**
 * At boot: turn the markers a previous process left open into resume rows, then, once the Host has settled, resume
 * the rows of the stop that just happened when the restart-resume setting allows it.
 */
export const bootRecovery = Layer.effectDiscard(
  Effect.gen(function* () {
    const inflight = yield* InflightTurns
    const recoveries = yield* Recoveries
    const store = yield* RecoveryStore
    const settings = yield* SidebarSettings
    const bootedAt = yield* Clock.currentTimeMillis
    const resumeOne = (entry: RestartRecoveryEntry) =>
      recoveries
        .resume(entry.sessionId)
        .pipe(Effect.catch(error => Effect.logWarning(`thread-sidebar: could not resume ${entry.sessionId} after the restart`, error)))
    const resumeAfterBoot = Effect.gen(function* () {
      if (!(yield* settings.resumeAfterRestart)) return
      const entries = (yield* store.list).filter(entry => entry.interruptedAt >= bootedAt - Duration.toMillis(AUTO_RESUME_WINDOW))
      yield* Effect.forEach(entries, resumeOne, { discard: true })
    })
    yield* DshxPlugin.worker(
      inflight.promote.pipe(
        Effect.catch(error => Effect.logWarning('thread-sidebar: the turns left open by the previous process were not promoted', error)),
        Effect.andThen(Effect.sleep(AUTO_RESUME_DELAY)),
        Effect.andThen(resumeAfterBoot),
        Effect.catch(error => Effect.logWarning('thread-sidebar: interrupted threads were not resumed after the restart', error)),
        Effect.withSpan('recoveries boot'),
      ),
    )
  }),
)
