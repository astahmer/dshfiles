import { attentionApi } from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Clock, Context, Duration, Effect, Layer, Option, Ref, Schedule, Stream } from 'effect'
import { InflightTurns, turnBoundaryFromEvent } from './inflight-turns.js'
import { RecoveryStore, type RestartRecoveryEntry } from './restart-recovery.js'
import { SessionEvents } from './session-events.js'
import type { HostCallFailed, HostCapabilityMissing, RuntimeStateFailed, RuntimeStateInvalid } from './sidebar-errors.js'
import { SidebarHost } from './sidebar-host-promise.js'
import { SidebarSettings } from './sidebar-settings.js'

const WAITING_TOOL = /wait|job_output|background/iu

/** The fixed continuation prompt, naming what the stop cut off when the capture recorded it. */
const resumePromptOf = (entry: RestartRecoveryEntry, automatic: boolean): string => {
  const cause = entry.reason === 'restart' ? 'a managed DSH restart' : 'DSH stopping without a restart capture (a crash or a forced stop)'
  const lines = [`Your previous turn was cut off by ${cause}.`]
  const tools = entry.openTools ?? []
  if (tools.length > 0) {
    lines.push(
      `These tool calls had started and never returned: ${tools.join(', ')}. Their effects are unknown: each may have finished, partly run, or not run.`,
    )
    if (tools.some(name => WAITING_TOOL.test(name)))
      lines.push('A background command you were waiting on was most likely stopped by the restart; check its state before waiting again.')
  }
  if (automatic) lines.push('This resume was sent automatically because automatic resume after a restart is on; it is sent once.')
  lines.push(
    'Continue from the persisted transcript and current workspace state.',
    'First inspect the last assistant and tool events and verify the current state of the workspace.',
    'Do not repeat or assume success for any tool action whose result is missing; verify its effects before taking further action.',
    'If safe continuation is unclear, explain what needs human input instead of guessing.',
  )
  return lines.join(' ')
}

/** Rows recorded this long before boot belong to the stop that just happened; older ones wait for a person. */
const AUTO_RESUME_WINDOW = Duration.minutes(30)
/** Resume requests in flight at once, like the sidebar's Resume all. */
const AUTO_RESUME_CONCURRENCY = 3
/** After the delay, the Session controller must answer a list before the first resume: up to 15 tries, 2 s apart. */
const HOST_READY_RETRY = { schedule: Schedule.spaced('2 seconds'), times: 14 } as const

type StateError = RuntimeStateFailed | RuntimeStateInvalid

export type AutoResumeSkip = 'over-limit' | 'continued' | 'failed' | 'crash'

/** What the automatic resume after this boot did, for the Agent tool and the Activity log. */
export interface AutoResumeOutcome {
  readonly at: number
  readonly resumed: ReadonlyArray<{ readonly sessionId: string; readonly openTools: ReadonlyArray<string> }>
  readonly skipped: ReadonlyArray<{ readonly sessionId: string; readonly reason: AutoResumeSkip }>
}

/** Threads a restart or a crash interrupted: list them, resume one with the fixed continuation prompt, or dismiss it. */
export class Recoveries extends Context.Service<
  Recoveries,
  {
    readonly pending: Effect.Effect<ReadonlyArray<RestartRecoveryEntry>, StateError>
    /** Queue the continuation prompt once: its stable request id makes a repeat a no-op. False when nothing waits. */
    readonly resume: (
      sessionId: string,
      options?: { readonly automatic?: boolean },
    ) => Effect.Effect<boolean, StateError | HostCapabilityMissing | HostCallFailed>
    readonly dismiss: (sessionId: string) => Effect.Effect<boolean, StateError>
    /** The automatic resume of this Host process, once it ran. */
    readonly lastAutoResume: Effect.Effect<Option.Option<AutoResumeOutcome>>
    readonly recordAutoResume: (outcome: AutoResumeOutcome) => Effect.Effect<void>
  }
>()('@dshfiles/thread-sidebar/Recoveries') {
  static readonly layer = Layer.effect(
    Recoveries,
    Effect.gen(function* () {
      const store = yield* RecoveryStore
      const host = yield* SidebarHost
      const lastAutoResume = yield* Ref.make(Option.none<AutoResumeOutcome>())
      const entryOf = (sessionId: string) => Effect.map(store.list, entries => entries.find(candidate => candidate.sessionId === sessionId))
      return Recoveries.of({
        pending: Effect.gen(function* () {
          yield* store.remove(new Set(yield* host.runningSessionIds))
          return yield* store.list
        }).pipe(Effect.withSpan('recoveries pending')),
        resume: Effect.fn('recoveries resume')(function* (sessionId, options) {
          const entry = yield* entryOf(sessionId)
          if (entry === undefined) return false
          if (!(yield* host.runningSessionIds).includes(sessionId)) {
            yield* host.queuePrompt({ requestId: entry.requestId, sessionId, text: resumePromptOf(entry, options?.automatic === true) })
          }
          yield* store.remove(new Set([sessionId]))
          return true
        }),
        dismiss: Effect.fn('recoveries dismiss')(function* (sessionId) {
          const exists = (yield* entryOf(sessionId)) !== undefined
          yield* store.remove(new Set([sessionId]))
          return exists
        }),
        lastAutoResume: Ref.get(lastAutoResume),
        recordAutoResume: outcome => Ref.set(lastAutoResume, Option.some(outcome)),
      })
    }),
  )
}

/** Where an automatic resume is reported for the user: one Activity log line per thread. */
export class AutoResumeReport extends Context.Service<AutoResumeReport, { readonly publish: (outcome: AutoResumeOutcome) => Effect.Effect<void> }>()(
  '@dshfiles/thread-sidebar/AutoResumeReport',
) {
  /** Info items of the inbox reach only the Activity log; nothing is reported when the inbox is not installed. */
  static readonly layer = Layer.effect(
    AutoResumeReport,
    Effect.gen(function* () {
      const apis = yield* HostApis
      const inbox = apis.client(attentionApi)
      return AutoResumeReport.of({
        publish: outcome =>
          Effect.gen(function* () {
            if (!(yield* apis.isServed(attentionApi))) return
            const lines = [
              ...outcome.resumed.map(entry => ({
                sessionId: entry.sessionId,
                reason: 'Resumed automatically after the restart.',
                detail: entry.openTools.length > 0 ? `Cut off: ${entry.openTools.join(', ')}` : undefined,
              })),
              ...outcome.skipped.flatMap(entry =>
                entry.reason === 'over-limit' || entry.reason === 'failed'
                  ? [
                      {
                        sessionId: entry.sessionId,
                        reason:
                          entry.reason === 'over-limit'
                            ? 'Not resumed automatically: over the automatic-resume limit. Resume it from Needs resume.'
                            : 'Automatic resume failed. Resume it from Needs resume.',
                        detail: undefined,
                      },
                    ]
                  : [],
              ),
            ]
            yield* Effect.forEach(
              lines,
              line =>
                inbox.publish({
                  source: 'thread-sidebar.auto-resume',
                  dedupeKey: `${line.sessionId}:${String(outcome.at)}`,
                  subject: { kind: 'session', id: line.sessionId },
                  reason: line.reason,
                  ...(line.detail === undefined ? {} : { detail: line.detail }),
                  severity: 'info',
                  verbs: ['Open'],
                }),
              { discard: true },
            )
          }).pipe(
            Effect.catchCause(cause => Effect.logWarning('thread-sidebar: the automatic resume was not written to the Activity log', cause)),
            Effect.withSpan('auto resume report'),
          ),
      })
    }),
  ).pipe(Layer.provide(HostApis.layer))

  /** Outcomes kept in memory, for tests without an inbox. */
  static readonly layerTest = (published: Ref.Ref<ReadonlyArray<AutoResumeOutcome>>) =>
    Layer.succeed(AutoResumeReport, AutoResumeReport.of({ publish: outcome => Ref.update(published, all => [...all, outcome]) }))
}

/** Which rows one automatic resume takes: managed-restart rows of this stop, newest first, up to `maxThreads`. */
export const planAutoResume = (input: {
  readonly entries: ReadonlyArray<RestartRecoveryEntry>
  readonly since: number
  readonly maxThreads: number
  readonly continued: ReadonlySet<string>
}) => {
  const recent = input.entries.filter(entry => entry.interruptedAt >= input.since).toSorted((left, right) => right.interruptedAt - left.interruptedAt)
  const skipped: { sessionId: string; reason: AutoResumeSkip }[] = []
  const chosen: RestartRecoveryEntry[] = []
  for (const entry of recent) {
    if (entry.reason !== 'restart') skipped.push({ sessionId: entry.sessionId, reason: 'crash' })
    else if (input.continued.has(entry.sessionId)) skipped.push({ sessionId: entry.sessionId, reason: 'continued' })
    else if (chosen.length >= input.maxThreads) skipped.push({ sessionId: entry.sessionId, reason: 'over-limit' })
    else chosen.push(entry)
  }
  return { chosen, skipped }
}

/**
 * At boot: turn the markers a previous process left open into resume rows, then, when the opt-in restart-resume
 * setting is on, wait the configured delay and for the Session controller, and resume each thread the managed restart
 * cut off, once. A thread that started a turn since boot (the user continued or stopped it) is left alone.
 */
export const bootRecovery = Layer.effectDiscard(
  Effect.gen(function* () {
    const inflight = yield* InflightTurns
    const recoveries = yield* Recoveries
    const store = yield* RecoveryStore
    const settings = yield* SidebarSettings
    const host = yield* SidebarHost
    const report = yield* AutoResumeReport
    const bootedAt = yield* Clock.currentTimeMillis
    const continued = yield* Ref.make<ReadonlySet<string>>(new Set())
    const events = yield* (yield* SessionEvents).subscribe
    yield* DshxPlugin.worker(
      Stream.runForEach(events, ({ sessionId, event }) =>
        turnBoundaryFromEvent(event) === 'start' ? Ref.update(continued, ids => new Set(ids).add(sessionId)) : Effect.void,
      ),
    )

    const resumeOne = (entry: RestartRecoveryEntry) =>
      recoveries.resume(entry.sessionId, { automatic: true }).pipe(
        Effect.map(accepted => (accepted ? ('resumed' as const) : ('continued' as const))),
        Effect.catch(error => Effect.as(Effect.logWarning(`thread-sidebar: could not resume ${entry.sessionId} after the restart`, error), 'failed' as const)),
      )

    const resumeAfterBoot = Effect.gen(function* () {
      const policy = yield* settings.autoResume
      if (!policy.enabled) return
      yield* Effect.sleep(Duration.seconds(policy.delaySeconds))
      yield* host.sessions.pipe(Effect.retry(HOST_READY_RETRY))
      const running = yield* host.runningSessionIds
      const started = yield* Ref.get(continued)
      const plan = planAutoResume({
        entries: yield* store.list,
        since: bootedAt - Duration.toMillis(AUTO_RESUME_WINDOW),
        maxThreads: policy.maxThreads,
        continued: new Set([...started, ...running]),
      })
      const results = yield* Effect.forEach(plan.chosen, entry => Effect.map(resumeOne(entry), result => ({ entry, result })), {
        concurrency: AUTO_RESUME_CONCURRENCY,
      })
      const outcome: AutoResumeOutcome = {
        at: yield* Clock.currentTimeMillis,
        resumed: results.flatMap(({ entry, result }) => (result === 'resumed' ? [{ sessionId: entry.sessionId, openTools: entry.openTools ?? [] }] : [])),
        skipped: [...plan.skipped, ...results.flatMap(({ entry, result }) => (result === 'resumed' ? [] : [{ sessionId: entry.sessionId, reason: result }]))],
      }
      yield* recoveries.recordAutoResume(outcome)
      yield* Effect.annotateCurrentSpan({ 'recoveries.auto.resumed': outcome.resumed.length, 'recoveries.auto.skipped': outcome.skipped.length })
      yield* report.publish(outcome)
    }).pipe(Effect.withSpan('recoveries auto resume'))

    yield* DshxPlugin.worker(
      inflight.promote.pipe(
        Effect.catch(error => Effect.logWarning('thread-sidebar: the turns left open by the previous process were not promoted', error)),
        Effect.andThen(resumeAfterBoot),
        Effect.catch(error => Effect.logWarning('thread-sidebar: interrupted threads were not resumed after the restart', error)),
        Effect.withSpan('recoveries boot'),
      ),
    )
  }),
)
