import { withSpan } from '@dshfiles/dshx/tracing'
import type { AutoSettleStatus, SettleRequestResult } from './auto-settle-api.js'
import { AutoSettleScanModel, type ScannedSession } from './auto-settle-scan.js'
import { DEFAULT_PREFERENCES, type AutoSettlePolicy } from './organization.js'
import type { RebasedThread } from './rebased-threads.js'

export interface AutoSettleClock {
  readonly now: () => number
  /** Run once after the delay; the returned function cancels it. */
  readonly schedule: (run: () => void, delayMs: number) => () => void
}

export interface AutoSettleSnapshot {
  readonly sessions: readonly ScannedSession[]
  readonly workspaceBySession: ReadonlyMap<string, string>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly settledSessionIds: ReadonlySet<string>
}

export interface AutoSettleSources {
  /** The sidebar settings, or undefined while the namespace is not registered on this Host. */
  readonly readPolicy: () => AutoSettlePolicy | undefined
  readonly readSnapshot: () => Promise<AutoSettleSnapshot>
  /** jj-integration's thread workspaces, or undefined when it is not installed. */
  readonly readRebasedThreads: () => Promise<readonly RebasedThread[] | undefined>
  /** One settings write for every id, keeping the first settle instant of each. */
  readonly settle: (sessionIds: readonly string[], now: number) => Promise<void>
}

const RECENT_LIMIT = 50

/** The Host waits this long after boot so the session controller and jj-integration finish activating. */
export const AUTO_SETTLE_BOOT_DELAY_MS = 30_000

type SettleEntry = AutoSettleStatus['recent'][number]

const policyKey = (policy: AutoSettlePolicy | undefined): string => JSON.stringify(policy ?? null)

const intervalMinutesOf = (policy: AutoSettlePolicy | undefined): number => policy?.scanIntervalMinutes ?? DEFAULT_PREFERENCES.scanIntervalMinutes

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 500)

/**
 * The Host half of auto-settle: a periodic scan that settles idle and rebased threads with no browser open,
 * and the entry point other plugins use to settle a thread for their own trigger. Its state (last scan,
 * next scan, recent settles) lives in this process; the settled status itself stays in the settings namespace.
 */
export const createAutoSettleScanner = (input: { readonly clock: AutoSettleClock; readonly sources: AutoSettleSources; readonly bootDelayMs?: number }) => {
  const { clock, sources } = input
  let cancelTimer: (() => void) | undefined
  let nextScanAt: number | null = null
  let lastScan: AutoSettleStatus['lastScan'] = null
  let scanning: Promise<void> | undefined
  let started = false
  let lastPolicyKey = policyKey(sources.readPolicy())
  const recent: SettleEntry[] = []

  const remember = (entries: readonly SettleEntry[]): void => {
    recent.unshift(...entries)
    recent.splice(RECENT_LIMIT)
  }

  const schedule = (delayMs: number): void => {
    cancelTimer?.()
    nextScanAt = clock.now() + delayMs
    cancelTimer = clock.schedule(() => {
      cancelTimer = undefined
      nextScanAt = null
      void scan().finally(() => {
        if (started && cancelTimer === undefined) schedule(intervalMinutesOf(sources.readPolicy()) * 60_000)
      })
    }, delayMs)
  }

  const runScan = async (): Promise<void> => {
    const policy = sources.readPolicy()
    if (policy === undefined || !AutoSettleScanModel.isActive(policy)) return
    const startedAt = clock.now()
    try {
      const decision = await withSpan('auto-settle scan', { attributes: { 'dshx.plugin.package': '@dshfiles/thread-sidebar' } }, async span => {
        const [snapshot, rebasedThreads] = await Promise.all([
          sources.readSnapshot(),
          policy.rebasedThreadSettleDelay === 'disabled' ? Promise.resolve(undefined) : sources.readRebasedThreads(),
        ])
        const result = AutoSettleScanModel.decide({ now: clock.now(), policy, rebasedThreads, ...snapshot })
        span.setAttribute('thread_sidebar.sessions.count', snapshot.sessions.length)
        span.setAttribute('thread_sidebar.settled.idle', result.idle.length)
        span.setAttribute('thread_sidebar.settled.rebased', result.rebased.length)
        const due = [...result.idle, ...result.rebased]
        if (due.length > 0) await sources.settle(due, clock.now())
        return result
      })
      const at = clock.now()
      remember([
        ...decision.idle.map(sessionId => ({ sessionId, reason: `idle for ${String(policy.idleMinutes)} min`, source: 'idle', at })),
        ...decision.rebased.map(sessionId => ({ sessionId, reason: 'jj workspace rebased', source: 'rebased', at })),
      ])
      lastScan = { at: startedAt, durationMs: at - startedAt, idleSettled: decision.idle.length, rebasedSettled: decision.rebased.length }
    } catch (error) {
      lastScan = { at: startedAt, durationMs: clock.now() - startedAt, idleSettled: 0, rebasedSettled: 0, error: errorText(error) }
    }
  }

  /** One scan at a time: a timer firing during a settings-triggered scan joins it instead of settling twice. */
  const scan = (): Promise<void> => {
    scanning ??= runScan().finally(() => {
      scanning = undefined
    })
    return scanning
  }

  return {
    start: (): void => {
      if (started) return
      started = true
      schedule(input.bootDelayMs ?? AUTO_SETTLE_BOOT_DELAY_MS)
    },
    stop: (): void => {
      started = false
      cancelTimer?.()
      cancelTimer = undefined
      nextScanAt = null
    },
    scan,
    /**
     * Settings changed. Only a change to the policy itself rescans now, like the browser did; the sidebar
     * writes the same namespace for every collapsed group or settled thread, which must not trigger a scan.
     */
    settingsChanged: (): void => {
      const key = policyKey(sources.readPolicy())
      if (key === lastPolicyKey) return
      lastPolicyKey = key
      if (started) schedule(0)
    },
    status: (): AutoSettleStatus => {
      const policy = sources.readPolicy()
      const active = policy !== undefined && AutoSettleScanModel.isActive(policy)
      return {
        hostScan: true,
        active,
        intervalMinutes: intervalMinutesOf(policy),
        nextScanAt: active ? nextScanAt : null,
        lastScan,
        recent: [...recent],
      }
    },
    requestSettle: async (request: {
      readonly sessionIds: readonly string[]
      readonly reason: string
      readonly source: string
    }): Promise<SettleRequestResult> => {
      const policy = sources.readPolicy()
      if (policy === undefined)
        throw new Error('The thread-sidebar settings namespace is unavailable on this Host; restart DSH so the thread sidebar can settle threads.')
      const snapshot = await sources.readSnapshot()
      const results: SettleRequestResult['results'] = []
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
        const at = clock.now()
        await sources.settle(due, at)
        remember(due.map(sessionId => ({ sessionId, reason: request.reason, source: request.source, at })))
      }
      return { results }
    },
  }
}

export type AutoSettleScanner = ReturnType<typeof createAutoSettleScanner>
