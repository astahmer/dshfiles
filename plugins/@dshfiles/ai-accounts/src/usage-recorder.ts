import type { Context } from '@deepseek-ai/cordis'
import { readCodexUsage, readOpenCodeUsage } from './usage.js'
import {
  USAGE_HISTORY_DOMAIN,
  parseUsageBucketKey,
  usageBucketKey,
  usageHistoryDomain,
  type QuotaSnapshot,
} from './usage-history.js'
import type { AccountProfile } from './api.js'

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

const readAccountWindows = async (account: AccountProfile) => {
  if (account.kind === 'codex') {
    const usage = await readCodexUsage(
      account.shadowHomePath === '' ? account.homePath : account.shadowHomePath,
    )
    return usage
  }
  if (account.kind === 'commandcode') return undefined
  const keyEnv = account.apiKeyEnv.trim()
  return readOpenCodeUsage(keyEnv.length === 0 ? '' : (process.env[keyEnv] ?? ''))
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
): Promise<number> => {
  const facility = ctx.get('storageDomain')
  if (facility === undefined) return 0
  const domain = await facility.open(usageHistoryDomain)
  const quota = domain.table('quota')

  let written = 0
  for (const account of accounts) {
    if (!account.enabled) continue
    const usage = await readAccountWindows(account)
    if (usage === undefined) continue
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
    }
    await quota.put(usageBucketKey(account.instanceId, at), snapshot)
    written += 1
  }

  const settings = domain.global.get()
  await domain.global.set({ ...settings, lastReadAt: Date.now() })
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
  for (const key of [...quota.keys()]) {
    const parsed = parseUsageBucketKey(key)
    // The bucket is an epoch division, so a stale row is recognized without
    // reading it back off the medium.
    if (parsed !== null && parsed.bucket * 15 * MINUTE_MS < cutoff) {
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
    .filter(([key]) => key.startsWith(`${instanceId}:`))
    .map(([, value]) => value)
    .filter(value => value.at >= sinceMs)
    .sort((left, right) => left.at - right.at)
  return rows
}

export { USAGE_HISTORY_DOMAIN }