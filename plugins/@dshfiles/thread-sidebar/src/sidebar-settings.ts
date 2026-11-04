import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import type { SettingsValue } from '@dshfiles/dshx/settings'
import { Clock, Context, Effect, Layer, Schedule, Semaphore, Stream, SubscriptionRef } from 'effect'
import type { AutoSettlePolicy } from './organization.js'
import { threadSidebarSettings } from './settings.js'
import { SidebarSettingsWriteFailed } from './sidebar-errors.js'
import { SettledThreadsModel, type SettledStatus } from './settled-threads.js'

export type SidebarSettingsValue = SettingsValue<typeof threadSidebarSettings.schema>

export const ThreadSidebarSettings = Settings.Tag<SidebarSettingsValue>(threadSidebarSettings.namespace)

const policyOf = (value: SidebarSettingsValue): AutoSettlePolicy => ({
  autoSettleEnabled: value.autoSettleEnabled,
  autoSettleSessionIds: [...value.autoSettleSessionIds],
  autoSettleDisabledSessionIds: [...value.autoSettleDisabledSessionIds],
  parkedSessionIds: [...value.parkedSessionIds],
  excludedSessionIds: [...value.excludedSessionIds],
  excludedWorkspaceIds: [...value.excludedWorkspaceIds],
  idleMinutes: value.idleMinutes,
  rebasedThreadSettleDelay: value.rebasedThreadSettleDelay,
  scanIntervalMinutes: value.scanIntervalMinutes,
})

const statusOf = (value: SidebarSettingsValue): SettledStatus => ({ settledSessionIds: [...value.settledSessionIds], settledAt: { ...value.settledAt } })

export const autoSettlePolicyKey = (policy: AutoSettlePolicy): string => JSON.stringify(policy)

/** A write based on a revision another writer (or this one, not yet refreshed) moved past is retried on a fresh read. */
const CONFLICT_RETRY = { schedule: Schedule.spaced('50 millis'), times: 20 } as const

/**
 * The settled status, the auto-settle policy and the restart-resume switch, read from and written to the sidebar's
 * settings namespace, so the settled-thread gate, the auto-settle scan and the Agent's settle verbs use the values
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
    readonly resumeAfterRestart: Effect.Effect<boolean>
    /** Settle several threads in one write, keeping the first settle instant of each and dropping their parked mark. */
    readonly settle: (sessionIds: ReadonlyArray<string>) => Effect.Effect<void, SidebarSettingsWriteFailed>
    /** Add or drop one settled id, returning the ids the namespace now holds. */
    readonly setSettled: (input: { readonly sessionId: string; readonly settled: boolean }) => Effect.Effect<ReadonlyArray<string>, SidebarSettingsWriteFailed>
  }
>()('@dshfiles/thread-sidebar/SidebarSettings') {
  static readonly layer = Layer.effect(
    SidebarSettings,
    Effect.gen(function* () {
      const settings = yield* ThreadSidebarSettings
      const exclusive = (yield* Semaphore.make(1)).withPermits(1)
      const settled = yield* SubscriptionRef.make<ReadonlyArray<string>>((yield* settings.get).settledSessionIds)
      yield* DshxPlugin.worker(settings.changes.pipe(Stream.runForEach(value => SubscriptionRef.set(settled, value.settledSessionIds))))

      const write = (change: (value: SidebarSettingsValue, now: number) => Partial<SidebarSettingsValue>) =>
        exclusive(
          Effect.gen(function* () {
            const snapshot = yield* settings.snapshot
            const now = yield* Clock.currentTimeMillis
            const patch = change(snapshot.value, now)
            yield* settings.update(patch, snapshot.revision)
            return { ...snapshot.value, ...patch }
          }).pipe(
            Effect.retry({ ...CONFLICT_RETRY, while: error => error._tag === 'SettingsConflict' }),
            Effect.tap(next => SubscriptionRef.set(settled, next.settledSessionIds)),
            Effect.mapError(cause => new SidebarSettingsWriteFailed({ cause })),
          ),
        )

      const settleAndUnpark = (value: SidebarSettingsValue, sessionIds: ReadonlyArray<string>, now: number): Partial<SidebarSettingsValue> => {
        const next = SettledThreadsModel.settleAndUnpark({ status: statusOf(value), parkedSessionIds: value.parkedSessionIds, sessionIds, now })
        return { settledSessionIds: next.settledSessionIds, settledAt: next.settledAt, parkedSessionIds: next.parkedSessionIds }
      }

      return SidebarSettings.of({
        settledSessionIdsNow: () => SubscriptionRef.getUnsafe(settled),
        settledSessionIds: SubscriptionRef.get(settled),
        policy: Effect.map(settings.get, policyOf),
        policyChanges: settings.changes.pipe(
          Stream.map(policyOf),
          Stream.changesWith((left, right) => autoSettlePolicyKey(left) === autoSettlePolicyKey(right)),
          Stream.drop(1),
        ),
        resumeAfterRestart: Effect.map(settings.get, value => value.resumeAfterRestart),
        settle: Effect.fn('settled threads settle')(function* (sessionIds) {
          yield* write((value, now) => settleAndUnpark(value, sessionIds, now))
        }),
        setSettled: Effect.fn('settled thread set')(function* (input) {
          const next = yield* write((value, now) => {
            if (input.settled) return settleAndUnpark(value, [input.sessionId], now)
            const unsettled = SettledThreadsModel.unsettle(statusOf(value), [input.sessionId])
            return { settledSessionIds: unsettled.settledSessionIds, settledAt: unsettled.settledAt }
          })
          return next.settledSessionIds
        }),
      })
    }),
  )
}

/** The namespace as DSH holds it; a Host without its settings entry runs on the schema defaults. */
export const sidebarSettingsLayer = SidebarSettings.layer.pipe(Layer.provide(Settings.layer(threadSidebarSettings)))
