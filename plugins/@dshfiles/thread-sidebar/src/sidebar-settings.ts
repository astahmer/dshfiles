import { Settings } from '@dshfiles/dshx/effect/settings'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Clock, Context, Effect, Layer, Schedule, Semaphore, Stream } from 'effect'
import type { AutoRestartPolicy } from './auto-restart.js'
import type { AutoSettlePolicy } from './organization.js'
import { threadSidebarSettings } from './settings.js'
import { SidebarSettingsWriteFailed } from './sidebar-errors.js'
import { SettledStore } from './settled-store.js'
import { SettledThreadsModel } from './settled-threads.js'
import type { SubscriptionDeliveryMode, SubscriptionNoticeLevel } from './subscription-levels.js'

export type SidebarSettingsValue = SettingsValue<typeof threadSidebarSettings.schema>

/** The opt-in resume after a managed restart: whether it runs, how many threads at most, and how long after boot. */
export interface AutoResumePolicy {
  readonly enabled: boolean
  readonly maxThreads: number
  readonly delaySeconds: number
}

export const ThreadSidebarSettings = Settings.Tag<SidebarSettingsValue>(threadSidebarSettings.namespace)

const policyOf = (value: SidebarSettingsValue): AutoSettlePolicy => ({
  autoSettleEnabled: value.autoSettleEnabled,
  autoSettleSessionIds: [...value.autoSettleSessionIds],
  autoSettleDisabledSessionIds: [...value.autoSettleDisabledSessionIds],
  parkedSessionIds: [...value.parkedSessionIds],
  excludedSessionIds: [...value.excludedSessionIds],
  excludedWorkspaceIds: [...value.excludedWorkspaceIds],
  idleMinutes: value.idleMinutes,
  subagentSettleHours: value.subagentSettleHours,
  rebasedThreadSettleDelay: value.rebasedThreadSettleDelay,
  scanIntervalMinutes: value.scanIntervalMinutes,
})

export const autoSettlePolicyKey = (policy: AutoSettlePolicy): string => JSON.stringify(policy)

/** A write based on a revision another writer (or this one, not yet refreshed) moved past is retried on a fresh read. */
const CONFLICT_RETRY = { schedule: Schedule.spaced('50 millis'), times: 20 } as const

/**
 * The settled status (in the sidebar's {@link SettledStore}), the auto-settle policy and the restart-resume switch (in
 * its settings namespace), so the settled-thread gate, the auto-settle scan and the Agent's settle verbs use the values
 * the sidebar shows instead of a second copy.
 */
export class SidebarSettings extends Context.Service<
  SidebarSettings,
  {
    /** The settled ids as of the last committed revision, read without running an effect for the prompt-admission hot path. */
    readonly settledSessionIdsNow: () => ReadonlyArray<string>
    readonly settledSessionIds: Effect.Effect<ReadonlyArray<string>>
    readonly policy: Effect.Effect<AutoSettlePolicy>
    /** Every change of the auto-settle policy after the current one; other sidebar writes do not emit. */
    readonly policyChanges: Stream.Stream<AutoSettlePolicy>
    /** Read once at boot: waits for the stored value, which DSH serves only once the plugin is active. */
    readonly autoResume: Effect.Effect<AutoResumePolicy>
    readonly autoRestart: Effect.Effect<AutoRestartPolicy>
    readonly subscriptionNoticeLevel: Effect.Effect<SubscriptionNoticeLevel>
    readonly subscriptionDelivery: Effect.Effect<SubscriptionDeliveryMode>
    /** Whether a settled or archived thread is lifted before one of its reminders is due. */
    readonly remindersWake: Effect.Effect<boolean>
    /** Settle several threads in one write, keeping the first settle instant of each and dropping their parked mark. */
    readonly settle: (sessionIds: ReadonlyArray<string>) => Effect.Effect<void, SidebarSettingsWriteFailed>
    /** Drop the settled status of several threads in one write, for a reminder that needs its thread awake. */
    readonly unsettle: (sessionIds: ReadonlyArray<string>) => Effect.Effect<void, SidebarSettingsWriteFailed>
    /** Add or drop one settled id, returning the ids the store now holds. */
    readonly setSettled: (input: { readonly sessionId: string; readonly settled: boolean }) => Effect.Effect<ReadonlyArray<string>, SidebarSettingsWriteFailed>
  }
>()('@dshfiles/thread-sidebar/SidebarSettings') {
  static readonly layer = Layer.effect(
    SidebarSettings,
    Effect.gen(function* () {
      const settings = yield* ThreadSidebarSettings
      const store = yield* SettledStore
      const exclusive = (yield* Semaphore.make(1)).withPermits(1)

      /** Write a settings patch on the revision it was planned against, retried on a conflict. */
      const write = (change: (value: SidebarSettingsValue, now: number) => Partial<SidebarSettingsValue>) =>
        exclusive(
          Effect.gen(function* () {
            const snapshot = yield* settings.snapshot
            const now = yield* Clock.currentTimeMillis
            const patch = change(snapshot.value, now)
            if (Object.keys(patch).length > 0) yield* settings.update(patch, snapshot.revision)
          }).pipe(
            Effect.retry({ ...CONFLICT_RETRY, while: error => error._tag === 'SettingsConflict' }),
            Effect.mapError(cause => new SidebarSettingsWriteFailed({ cause })),
          ),
        )

      /** Settle in the store, then drop the parked mark of each newly settled id from Settings when one holds it. */
      const settleAndUnpark = (sessionIds: ReadonlyArray<string>) =>
        Effect.gen(function* () {
          const next = yield* store.update((status, now) => {
            const settled = SettledThreadsModel.settle(status, sessionIds, now)
            return { status: settled, result: settled.settledSessionIds }
          })
          const targets = new Set(sessionIds)
          yield* write(value =>
            value.parkedSessionIds.some(sessionId => targets.has(sessionId))
              ? { parkedSessionIds: value.parkedSessionIds.filter(sessionId => !targets.has(sessionId)) }
              : {},
          )
          return next
        })

      const unsettle = (sessionIds: ReadonlyArray<string>) =>
        store.update(status => {
          const unsettled = SettledThreadsModel.unsettle(status, sessionIds)
          return { status: unsettled, result: unsettled.settledSessionIds }
        })

      return SidebarSettings.of({
        settledSessionIdsNow: () => store.current().settledSessionIds,
        settledSessionIds: Effect.map(store.snapshot, snapshot => snapshot.settledSessionIds),
        policy: Effect.map(settings.get, policyOf),
        policyChanges: settings.changes.pipe(
          Stream.map(policyOf),
          Stream.changesWith((left, right) => autoSettlePolicyKey(left) === autoSettlePolicyKey(right)),
          Stream.drop(1),
        ),
        autoResume: Effect.map(settings.loaded, value => ({
          enabled: value.resumeAfterRestart,
          maxThreads: value.resumeAfterRestartMaxThreads,
          delaySeconds: value.resumeAfterRestartDelaySeconds,
        })),
        autoRestart: Effect.map(settings.get, value => ({ enabled: value.autoRestartWhenIdle, quietSeconds: value.autoRestartQuietSeconds })),
        subscriptionNoticeLevel: Effect.map(settings.get, value => value.subscriptionNoticeLevel),
        subscriptionDelivery: Effect.map(settings.get, value => value.subscriptionDelivery),
        remindersWake: Effect.map(settings.get, value => value.remindersWakeEnabled),
        settle: Effect.fn('settled threads settle')(function* (sessionIds) {
          yield* settleAndUnpark(sessionIds)
        }),
        unsettle: Effect.fn('settled threads unsettle')(function* (sessionIds) {
          yield* unsettle(sessionIds)
        }),
        setSettled: Effect.fn('settled thread set')(function* (input) {
          return yield* input.settled ? settleAndUnpark([input.sessionId]) : unsettle([input.sessionId])
        }),
      })
    }),
  ).pipe(Layer.provideMerge(SettledStore.layer))
}

/** The namespace as DSH holds it; a Host without its settings entry runs on the schema defaults. */
export const sidebarSettingsLayer = SidebarSettings.layer.pipe(Layer.provide(Settings.layer(threadSidebarSettings)))
