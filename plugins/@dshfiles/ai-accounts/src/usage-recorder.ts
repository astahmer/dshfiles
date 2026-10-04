import type { Context } from '@deepseek-ai/cordis'
import { resolveCodexHomeLayout } from './codex-home.js'
import { readCodexUsage, readOpenCodeUsage } from './usage.js'
import {
  USAGE_HISTORY_DOMAIN,
  boundUsageHistoryPoints,
  parseUsageBucketKey,
  usageBucketKey,
  usageHistoryDomain,
  type QuotaSnapshot,
} from './usage-history.js'
import { usageMetaSchema, type UsageMeta, type UsageHistorySettings } from './usage-history-model.js'
import type { AccountProfile } from './api.js'
import { readKeyFromEnv } from './credentials.js'

/**
 * Quota history collection.
 *
 * One poll sweeps every enabled account and writes at most one row per account
 * per bucket, so re-running within a bucket updates rather than accumulates. The
 * schedule lives in the domain's global value, so the chosen interval survives a
 * restart instead of snapping back to a default.
 *
 * Collection is deliberately read-only against the providers: it asks for quota
 * and forgets it, and the dashboard reads from the same rows.
 */

const MINUTE_MS = 60_000
const SCHEDULER_CHECK_MS = MINUTE_MS
const PROVIDER_READ_CONCURRENCY = 4

const readAccountWindows = async (account: AccountProfile, signal?: AbortSignal) => {
  if (signal?.aborted) return undefined
  if (account.kind === 'codex') {
    const layout = resolveCodexHomeLayout({
      homePath: account.homePath,
      shadowHomePath: account.shadowHomePath,
    })
    return readCodexUsage(layout.effectiveHomePath, signal)
  }
  if (account.kind === 'commandcode') return undefined
  return readOpenCodeUsage(readKeyFromEnv(account.apiKeyEnv), signal)
}

const defaultUsageMeta = (): UsageMeta => usageMetaSchema.parse({})

export const readUsageHistorySettings = async (ctx: Context): Promise<UsageMeta> => {
  const facility = ctx.get('storageDomain')
  if (facility === undefined) return defaultUsageMeta()
  const domain = await facility.open(usageHistoryDomain)
  return domain.global.get()
}

export const saveUsageHistorySettings = async (
  ctx: Context,
  settings: UsageHistorySettings,
): Promise<UsageMeta> => {
  const facility = ctx.get('storageDomain')
  if (facility === undefined) throw new Error('Usage history storage is unavailable.')
  const domain = await facility.open(usageHistoryDomain)
  const next = usageMetaSchema.parse({ ...domain.global.get(), ...settings })
  await domain.global.set(next)
  await pruneUsageHistory(ctx, next.retentionDays)
  return next
}

/**
 * Poll every account once and store the readings.
 *
 * Exported so the API can offer a manual refresh, which uses the same path and
 * therefore cannot diverge from the scheduled one.
 */
export const collectUsageHistory = async (
  ctx: Context,
  accounts: readonly AccountProfile[],
  signal?: AbortSignal,
): Promise<number> => {
  const facility = ctx.get('storageDomain')
  if (facility === undefined) return 0
  const domain = await facility.open(usageHistoryDomain)
  const quota = domain.table('quota')
  const settings = domain.global.get()

  let written = 0
  const enabled = accounts.filter(account => account.enabled && account.kind !== 'commandcode')
  // Provider reads are independent, but bound concurrency to avoid an
  // unbounded burst of authenticated requests for profiles with many accounts.
  for (let offset = 0; offset < enabled.length; offset += PROVIDER_READ_CONCURRENCY) {
    if (signal?.aborted) break
    const batch = enabled.slice(offset, offset + PROVIDER_READ_CONCURRENCY)
    const results = await Promise.all(batch.map(async account => {
      try {
        return { account, usage: await readAccountWindows(account, signal) }
      } catch {
        return { account, usage: undefined }
      }
    }))
    if (signal?.aborted) break

    for (const { account, usage } of results) {
      if (usage === undefined || usage.status !== 'ok') continue
      const at = Date.now()
      const windows: Record<string, number> = {}
      const resetsAt: Record<string, number> = {}
      for (const window of usage.windows) {
        windows[window.label] = window.percentRemaining
        if (window.resetsAt !== null) resetsAt[window.label] = window.resetsAt
      }
      const snapshot: QuotaSnapshot = {
        at,
        instanceId: account.instanceId,
        windows,
        resetsAt,
        bankedResets: usage.bankedResets,
        bankedResetExpiries: usage.bankedResetExpiries,
      }
      await quota.put(usageBucketKey(account.instanceId, at, settings.intervalMinutes), snapshot)
      written += 1
    }
  }

  const attemptedAt = Date.now()
  await domain.global.set({
    ...settings,
    lastAttemptAt: attemptedAt,
    ...(written > 0 ? { lastReadAt: attemptedAt } : {}),
  })
  return written
}

/** Oldest snapshot worth keeping, given the configured retention. */
export const pruneUsageHistory = async (
  ctx: Context,
  retentionDays: number,
): Promise<number> => {
  const facility = ctx.get('storageDomain')
  if (facility === undefined) return 0
  const domain = await facility.open(usageHistoryDomain)
  const quota = domain.table('quota')
  const cutoff = Date.now() - retentionDays * 24 * 60 * MINUTE_MS
  let removed = 0
  for (const [key, snapshot] of [...quota.entries()]) {
    if (snapshot.at < cutoff) {
      await quota.delete(key)
      removed += 1
    }
  }
  return removed
}

/** Readings for one account, oldest first, so a chart reads left to right. */
export const readUsageHistory = async (
  ctx: Context,
  instanceId: string,
  sinceMs: number,
): Promise<readonly QuotaSnapshot[]> => {
  const facility = ctx.get('storageDomain')
  if (facility === undefined) return []
  const domain = await facility.open(usageHistoryDomain)
  const rows = [...domain.table('quota').entries()]
    .filter(([key, value]) => parseUsageBucketKey(key)?.instanceId === instanceId && value.at >= sinceMs)
    .map(([, value]) => value)
    .map(value => ({ ...value, bankedResetExpiries: value.bankedResetExpiries ?? [] }))
  return boundUsageHistoryPoints(rows)
}

export interface UsageHistoryScheduler {
  collectNow(): Promise<number>
  dispose(): void
}

/** Share one in-flight collection between the manual action and host timer. */
export const createUsageHistoryScheduler = (
  ctx: Context,
  readAccounts: () => Promise<readonly AccountProfile[]>,
  now: () => number = Date.now,
): UsageHistoryScheduler => {
  let disposed = false
  let inFlight: Promise<number> | null = null
  let controller: AbortController | null = null

  const collectNow = (): Promise<number> => {
    if (disposed) return Promise.resolve(0)
    if (inFlight !== null) return inFlight
    const currentController = new AbortController()
    controller = currentController
    inFlight = (async () => {
      const accounts = await readAccounts()
      const recorded = await collectUsageHistory(ctx, accounts, currentController.signal)
      const settings = await readUsageHistorySettings(ctx)
      await pruneUsageHistory(ctx, settings.retentionDays)
      return recorded
    })().finally(() => {
      if (controller === currentController) {
        controller = null
        inFlight = null
      }
    })
    return inFlight
  }

  const collectIfDue = async (): Promise<void> => {
    if (disposed || inFlight !== null || ctx.get('storageDomain') === undefined) return
    const settings = await readUsageHistorySettings(ctx)
    const latestAttempt = settings.lastAttemptAt ?? settings.lastReadAt
    if (latestAttempt === null || now() - latestAttempt >= settings.intervalMinutes * MINUTE_MS) {
      await collectNow()
    }
  }

  const timer = setInterval(() => {
    void collectIfDue().catch(() => undefined)
  }, SCHEDULER_CHECK_MS)
  void collectIfDue().catch(() => undefined)

  return {
    collectNow,
    dispose: () => {
      if (disposed) return
      disposed = true
      clearInterval(timer)
      controller?.abort()
    },
  }
}

export { USAGE_HISTORY_DOMAIN }
