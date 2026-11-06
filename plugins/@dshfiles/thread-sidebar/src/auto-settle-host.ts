import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Clock, Context, Duration, Effect, Layer, Option, Queue, Ref, Semaphore, Stream } from 'effect'
import type { AutoSettleStatus, SettleRequestResult } from './auto-settle-api.js'
import { AutoSettleScanModel, type ScannedSession } from './auto-settle-scan.js'
import { SidebarOrganization } from './organization.js'
import { OutsideReload } from './outside-reload-promise.js'
import type { RebasedThread } from './rebased-threads.js'
import type { HostCallFailed, SidebarSettingsWriteFailed } from './sidebar-errors.js'
import { SidebarHost } from './sidebar-host-promise.js'
import { SidebarSettings } from './sidebar-settings.js'

export interface AutoSettleSnapshot {
  readonly sessions: readonly ScannedSession[]
  readonly workspaceBySession: ReadonlyMap<string, string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
}

/** What a scan reads from the Host: the Sessions and their workspaces, and jj-integration's thread workspaces. */
export class AutoSettleSources extends Context.Service<
  AutoSettleSources,
  {
    readonly snapshot: Effect.Effect<AutoSettleSnapshot, HostCallFailed>
    /** jj-integration's thread workspaces, or none when it is not installed. */
    readonly rebasedThreads: Effect.Effect<Option.Option<ReadonlyArray<RebasedThread>>, HostCallFailed>
    /** Stop the running jobs these Sessions own; answers the job ids a stop was requested for. */
    readonly stopJobs: (input: { readonly sessionIds: ReadonlyArray<string>; readonly reason: string }) => Effect.Effect<ReadonlyArray<string>>
  }
>()('@dshfiles/thread-sidebar/AutoSettleSources') {
  static readonly layer = Layer.effect(
    AutoSettleSources,
    Effect.gen(function* () {
      const host = yield* SidebarHost
      const settings = yield* SidebarSettings
      return AutoSettleSources.of({
        snapshot: Effect.gen(function* () {
          const sessions = (yield* host.sessions).map(item => ({
            id: item.sessionId,
            running: item.running,
            blank: item.blank,
            updatedAt: item.updatedAt,
            parentId: item.parentSessionId,
            pendingInteraction: item.pendingQuestions > 0,
            cwd: item.cwd,
          }))
          return {
            sessions,
            workspaceBySession: SidebarOrganization.workspaceForSessions({ workspaces: yield* host.workspaces, sessions }),
            archivedSessionIds: new Set(yield* host.archivedSessionIds),
            pinnedSessionIds: new Set(yield* host.pinnedSessionIds),
            settledSessionIds: new Set(yield* settings.settledSessionIds),
          }
        }),
        rebasedThreads: host.rebasedThreads,
        stopJobs: host.stopJobs,
      })
    }),
  )
}

const RECENT_LIMIT = 50

/** The Host waits this long after boot so the session controller and jj-integration finish activating. */
export const AUTO_SETTLE_BOOT_DELAY = Duration.seconds(30)

type SettleEntry = AutoSettleStatus['recent'][number]

interface ScanState {
  readonly nextScanAt: number | null
  readonly lastScan: AutoSettleStatus['lastScan']
  readonly recent: readonly SettleEntry[]
}

const errorText = (error: { readonly message: string }): string => error.message.slice(0, 500)

/**
 * The Host half of auto-settle: a scan that settles idle and rebased threads with no browser open, and the entry
 * point other plugins use to settle a thread for their own trigger. Its state (last scan, next scan, recent settles)
 * lives in this process; the settled status itself stays in the settings namespace.
 */
export class AutoSettle extends Context.Service<
  AutoSettle,
  {
    readonly status: Effect.Effect<AutoSettleStatus>
    readonly scan: Effect.Effect<void>
    readonly setNextScanAt: (at: number | null) => Effect.Effect<void>
    readonly requestSettle: (request: {
      readonly sessionIds: readonly string[]
      readonly reason: string
      readonly source: string
    }) => Effect.Effect<SettleRequestResult, HostCallFailed | SidebarSettingsWriteFailed>
  }
>()('@dshfiles/thread-sidebar/AutoSettle') {
  static readonly layer = Layer.effect(
    AutoSettle,
    Effect.gen(function* () {
      const sources = yield* AutoSettleSources
      const settings = yield* SidebarSettings
      const state = yield* Ref.make<ScanState>({ nextScanAt: null, lastScan: null, recent: [] })
      const scanning = yield* Semaphore.make(1)

      const remember = (entries: readonly SettleEntry[]) =>
        Ref.update(state, current => ({ ...current, recent: [...entries, ...current.recent].slice(0, RECENT_LIMIT) }))

      const recordScan = (lastScan: NonNullable<ScanState['lastScan']>) => Ref.update(state, current => ({ ...current, lastScan }))

      const decide = (policy: Effect.Success<typeof settings.policy>) =>
        Effect.gen(function* () {
          const [snapshot, rebasedThreads] = yield* Effect.all(
            [sources.snapshot, policy.rebasedThreadSettleDelay === 'disabled' ? Effect.succeedNone : sources.rebasedThreads],
            { concurrency: 2 },
          )
          const now = yield* Clock.currentTimeMillis
          const result = AutoSettleScanModel.decide({ now, policy, rebasedThreads: Option.getOrUndefined(rebasedThreads), ...snapshot })
          yield* Effect.annotateCurrentSpan({
            'thread_sidebar.sessions.count': snapshot.sessions.length,
            'thread_sidebar.settled.idle': result.idle.length,
            'thread_sidebar.settled.rebased': result.rebased.length,
            'thread_sidebar.settled.subagents': result.subagents.length,
          })
          const due = [...result.idle, ...result.rebased, ...result.subagents]
          if (due.length > 0) yield* settings.settle(due)
          const jobsStopped =
            result.subagents.length === 0
              ? []
              : yield* sources.stopJobs({
                  sessionIds: result.subagents,
                  reason: `stopped: subagent thread settled after ${String(policy.subagentSettleHours)} h idle`,
                })
          yield* Effect.annotateCurrentSpan({ 'thread_sidebar.jobs.stopped': jobsStopped.length })
          return { ...result, jobsStopped: jobsStopped.length }
        }).pipe(Effect.withSpan('auto-settle scan', { attributes: { 'dshx.plugin.package': '@dshfiles/thread-sidebar' } }))

      const runScan = Effect.gen(function* () {
        const policy = yield* settings.policy
        if (!AutoSettleScanModel.isActive(policy)) return
        const startedAt = yield* Clock.currentTimeMillis
        const decision = yield* Effect.result(decide(policy))
        const at = yield* Clock.currentTimeMillis
        if (decision._tag === 'Failure') {
          return yield* recordScan({
            at: startedAt,
            durationMs: at - startedAt,
            idleSettled: 0,
            rebasedSettled: 0,
            subagentSettled: 0,
            jobsStopped: 0,
            error: errorText(decision.failure),
          })
        }
        yield* remember([
          ...decision.success.idle.map(sessionId => ({ sessionId, reason: `idle for ${String(policy.idleMinutes)} min`, source: 'idle', at })),
          ...decision.success.rebased.map(sessionId => ({ sessionId, reason: 'jj workspace rebased', source: 'rebased', at })),
          ...decision.success.subagents.map(sessionId => ({
            sessionId,
            reason: `subagent idle for ${String(policy.subagentSettleHours)} h; its jobs stopped`,
            source: 'subagent',
            at,
          })),
        ])
        yield* recordScan({
          at: startedAt,
          durationMs: at - startedAt,
          idleSettled: decision.success.idle.length,
          rebasedSettled: decision.success.rebased.length,
          subagentSettled: decision.success.subagents.length,
          jobsStopped: decision.success.jobsStopped,
        })
      })

      return AutoSettle.of({
        status: Effect.gen(function* () {
          const policy = yield* settings.policy
          const active = AutoSettleScanModel.isActive(policy)
          const current = yield* Ref.get(state)
          return {
            hostScan: true as const,
            active,
            intervalMinutes: policy.scanIntervalMinutes,
            nextScanAt: active ? current.nextScanAt : null,
            lastScan: current.lastScan,
            recent: [...current.recent],
          }
        }),
        // One scan at a time: a timer firing during a settings-triggered scan waits instead of settling twice.
        scan: scanning.withPermits(1)(runScan),
        setNextScanAt: at => Ref.update(state, current => ({ ...current, nextScanAt: at })),
        requestSettle: Effect.fn('auto-settle request')(function* (request) {
          const policy = yield* settings.policy
          const snapshot = yield* sources.snapshot
          const results: Array<SettleRequestResult['results'][number]> = []
          const due: string[] = []
          for (const sessionId of new Set(request.sessionIds)) {
            const outcome = AutoSettleScanModel.requestOutcome({ sessionId, policy, ...snapshot })
            if (outcome === 'settle') {
              due.push(sessionId)
              results.push({ sessionId, outcome: 'settled' })
              continue
            }
            results.push(outcome === 'already-settled' ? { sessionId, outcome } : { sessionId, outcome: 'skipped', skipReason: outcome })
          }
          if (due.length > 0) {
            yield* settings.settle(due)
            const at = yield* Clock.currentTimeMillis
            yield* remember(due.map(sessionId => ({ sessionId, reason: request.reason, source: request.source, at })))
          }
          return { results }
        }),
      })
    }),
  )

  /** Remember when the next scan is due, wait for it or for a policy change, scan, repeat. */
  static readonly schedule = (bootDelay: Duration.Duration = AUTO_SETTLE_BOOT_DELAY) =>
    Layer.effectDiscard(
      Effect.gen(function* () {
        const autoSettle = yield* AutoSettle
        const settings = yield* SidebarSettings
        const outside = yield* OutsideReload
        // Only a change to the policy rescans now; the sidebar writes the same namespace for every collapsed group.
        const policyChanged = yield* Queue.sliding<void>(1)
        yield* DshxPlugin.worker(Stream.runForEach(settings.policyChanges, () => Queue.offer(policyChanged, undefined)))
        const waitFor = (delay: Duration.Duration) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis
            yield* autoSettle.setNextScanAt(now + Duration.toMillis(delay))
            yield* Effect.raceFirst(Effect.sleep(delay), Queue.take(policyChanged))
            yield* autoSettle.setNextScanAt(null)
          })
        yield* DshxPlugin.worker(
          Effect.gen(function* () {
            yield* waitFor(bootDelay)
            for (;;) {
              yield* outside.run(autoSettle.scan)
              yield* waitFor(Duration.minutes((yield* settings.policy).scanIntervalMinutes))
            }
          }),
        )
      }),
    )
}
