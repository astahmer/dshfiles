import { Clock, Context, Duration, Effect, Layer, Option, Ref, Stream, SubscriptionRef } from 'effect'
import { RestartControl } from './restart.js'
import { SidebarHost } from './sidebar-host-promise.js'

/** Whether the automatic restart runs and how long DSH must stay idle before it does. */
export interface AutoRestartPolicy {
  readonly enabled: boolean
  readonly quietSeconds: number
}

/** What still keeps DSH busy: running turns (subagents included), running background jobs, open user questions. */
export interface AutoRestartBusy {
  readonly turns: number
  readonly jobs: number
  readonly questions: number
}

export type AutoRestartPhase = 'none' | 'disabled' | 'unsupervised' | 'postponed' | 'waiting' | 'quiet' | 'countdown' | 'restarting'

export interface AutoRestartStatus {
  readonly phase: AutoRestartPhase
  readonly enabled: boolean
  /** The updates only a Host restart applies: plugin packages whose Host files changed, and `profile` for a changed profile. */
  readonly updates: ReadonlyArray<string>
  readonly busy: AutoRestartBusy
  readonly quietSeconds: number
  /** When the restart runs if DSH stays idle; set in the quiet and countdown phases. */
  readonly restartAt: number | null
  readonly postponedUntil: number | null
  /** How to start DSH under the supervisor, shown when no supervisor can restart it. */
  readonly command: string | null
  readonly run: string
}

/** How often the policy re-reads the updates and the busy state. */
const TICK = Duration.seconds(5)
/** The visible notice: the last part of the quiet period, before the restart. */
export const AUTO_RESTART_NOTICE_SECONDS = 30
export const DEFAULT_POSTPONE_MINUTES = 60
const NO_BUSY: AutoRestartBusy = { turns: 0, jobs: 0, questions: 0 }

const isBusy = (busy: AutoRestartBusy): boolean => busy.turns > 0 || busy.jobs > 0 || busy.questions > 0

const sameStatus = (left: AutoRestartStatus, right: AutoRestartStatus): boolean => JSON.stringify(left) === JSON.stringify(right)

/** The supervised launcher this repository ships; `DSHFILES_DIR` names the checkout when the launcher set it. */
export const supervisedLaunchCommand = (dshfilesDirectory: string | undefined): string =>
  `${dshfilesDirectory?.trim() || '<dshfiles checkout>'}/scripts/dsh-launcher`

/**
 * Restarts DSH on its own once an update waits for a Host restart and nothing works: no running turn (subagents
 * included), no running background job and no open user question for the whole quiet period. The last
 * {@link AUTO_RESTART_NOTICE_SECONDS} seconds are a visible countdown the user can postpone. Right before restarting it
 * reads everything again; the managed restart then records any turn that still started, so it resumes after boot.
 * Without a supervisor it never exits DSH: it only reports the command that starts one.
 */
export class AutoRestart extends Context.Service<
  AutoRestart,
  {
    readonly status: Effect.Effect<AutoRestartStatus>
    /** Each status that differs from the one before it; an unchanged tick emits nothing. */
    readonly statusChanges: Stream.Stream<AutoRestartStatus>
    /** Hold the automatic restart for `minutes`; the pending updates stay pending. */
    readonly postpone: (minutes: number) => Effect.Effect<{ readonly postponedUntil: number }>
    /** Drop a postponement, so the next idle quiet period restarts again. */
    readonly resume: Effect.Effect<{ readonly resumed: boolean }>
  }
>()('@dshfiles/thread-sidebar/AutoRestart') {
  static readonly layerWith = (input: {
    readonly policy: Effect.Effect<AutoRestartPolicy>
    /** The pending Host-restart updates, empty when nothing waits. */
    readonly updates: Effect.Effect<ReadonlyArray<string>>
    readonly command: string
    readonly tick?: Duration.Duration
  }) =>
    Layer.effect(
      AutoRestart,
      Effect.gen(function* () {
        const control = yield* RestartControl
        const host = yield* SidebarHost
        const idleSince = yield* Ref.make(Option.none<number>())
        const postponedUntil = yield* Ref.make(Option.none<number>())
        const restarting = yield* Ref.make(false)
        const last = yield* SubscriptionRef.make<AutoRestartStatus>({
          phase: 'none',
          enabled: false,
          updates: [],
          busy: NO_BUSY,
          quietSeconds: 0,
          restartAt: null,
          postponedUntil: null,
          command: null,
          run: control.run,
        })

        // Cheapest first: the Session list behind open questions is read only once no turn and no job runs.
        const busyNow = Effect.gen(function* () {
          const turns = (yield* host.runningSessionIds).length
          const jobs = yield* host.runningJobCount
          if (turns > 0 || jobs > 0) return { turns, jobs, questions: 0 }
          const sessions = yield* host.sessions.pipe(Effect.orElseSucceed(() => []))
          return { turns, jobs, questions: sessions.filter(session => session.pendingQuestions > 0).length }
        })

        const evaluate = Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis
          const policy = yield* input.policy
          const updates = yield* input.updates
          const postponed = Option.filter(yield* Ref.get(postponedUntil), until => until > now)
          const base = {
            enabled: policy.enabled,
            updates,
            quietSeconds: policy.quietSeconds,
            postponedUntil: Option.getOrNull(postponed),
            command: control.available ? null : input.command,
            run: control.run,
          }
          const idle = (phase: AutoRestartPhase, busy: AutoRestartBusy = NO_BUSY): Effect.Effect<AutoRestartStatus> =>
            Effect.as(Ref.set(idleSince, Option.none()), { ...base, phase, busy, restartAt: null })
          if (yield* Ref.get(restarting)) return { ...base, phase: 'restarting' as const, busy: NO_BUSY, restartAt: null }
          if (updates.length === 0) return yield* idle('none')
          if (!policy.enabled) return yield* idle('disabled')
          if (!control.available) return yield* idle('unsupervised')
          if (Option.isSome(postponed)) return yield* idle('postponed')
          const busy = yield* busyNow
          if (isBusy(busy)) return yield* idle('waiting', busy)
          const since = Option.getOrElse(yield* Ref.get(idleSince), () => now)
          yield* Ref.set(idleSince, Option.some(since))
          const restartAt = since + policy.quietSeconds * 1000
          if (now < restartAt) {
            const phase = restartAt - now <= AUTO_RESTART_NOTICE_SECONDS * 1000 ? ('countdown' as const) : ('quiet' as const)
            return { ...base, phase, busy, restartAt }
          }
          // The check right before restarting: anything that started since the last tick cancels it.
          const again = yield* busyNow
          if (isBusy(again)) return yield* idle('waiting', again)
          yield* Ref.set(restarting, true)
          yield* Effect.logInfo(`thread-sidebar: auto restart: idle for ${String(policy.quietSeconds)} s with ${updates.join(', ')} pending; restarting DSH`)
          const requested = yield* control.request.pipe(
            Effect.as(true),
            Effect.catch(error => Effect.as(Effect.logWarning('thread-sidebar: auto restart could not start', error), false)),
          )
          if (!requested) {
            yield* Ref.set(restarting, false)
            return yield* idle('waiting')
          }
          return { ...base, phase: 'restarting' as const, busy: NO_BUSY, restartAt: now }
        }).pipe(
          Effect.tap(status => SubscriptionRef.set(last, status)),
          Effect.withSpan('auto restart check'),
        )

        yield* Effect.forkScoped(Effect.sleep(input.tick ?? TICK).pipe(Effect.andThen(evaluate), Effect.forever))

        return AutoRestart.of({
          status: SubscriptionRef.get(last),
          statusChanges: SubscriptionRef.changes(last).pipe(Stream.changesWith(sameStatus), Stream.drop(1)),
          postpone: minutes =>
            Effect.gen(function* () {
              const until = (yield* Clock.currentTimeMillis) + Math.round(minutes * 60_000)
              yield* Ref.set(postponedUntil, Option.some(until))
              yield* Ref.set(idleSince, Option.none())
              yield* SubscriptionRef.update(last, (status): AutoRestartStatus =>
                status.phase === 'restarting' ? status : { ...status, phase: 'postponed', restartAt: null, postponedUntil: until },
              )
              return { postponedUntil: until }
            }).pipe(Effect.withSpan('auto restart postpone')),
          resume: Effect.gen(function* () {
            const held = Option.isSome(yield* Ref.get(postponedUntil))
            yield* Ref.set(postponedUntil, Option.none())
            return { resumed: held }
          }),
        })
      }),
    )
}
