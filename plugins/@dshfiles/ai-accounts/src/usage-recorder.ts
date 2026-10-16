import type { Context } from '@deepseek-ai/cordis'
import { readAccountUsage } from './account-usage.js'
import { USAGE_HISTORY_DOMAIN, UsageHistoryModel, usageHistoryDomain, type QuotaSnapshot } from './usage-history.js'
import { usageMetaSchema, type UsageMeta, type UsageHistorySettings } from './usage-history-model.js'
import type { AccountProfile, UsageCard } from './api.js'
import type { CredentialValueResolver } from './credentials.js'

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
const SCHEDULER_CHECK_MS = 60_000
const PROVIDER_READ_CONCURRENCY = 4

export type AccountUsageReader = (account: AccountProfile, signal: AbortSignal | undefined) => Promise<UsageCard>

interface AccountsForCollection {
  readonly accounts: readonly AccountProfile[]
  readonly shadowRoot: string
}

const providerReader =
  (shadowRoot: string, resolveCredential?: CredentialValueResolver): AccountUsageReader =>
  (account, signal) =>
    readAccountUsage({ account, shadowRoot, signal, resolveCredential })

const facilityOf = (ctx: Context) => ctx.get('storageDomain')
type Facility = NonNullable<ReturnType<typeof facilityOf>>
const openDomain = (facility: Facility) => facility.open(usageHistoryDomain)
type UsageDomain = Awaited<ReturnType<typeof openDomain>>

/**
 * The storage facility refuses a second `open` of a name that is already open,
 * so the domain is opened once per facility and every reader shares the handle.
 * The Host closes it on unload, so a reload can open it again.
 */
const openedDomains = new WeakMap<Facility, Promise<UsageDomain>>()

const usageDomain = (ctx: Context): Promise<UsageDomain> | undefined => {
  const facility = facilityOf(ctx)
  if (facility === undefined) return undefined
  const existing = openedDomains.get(facility)
  if (existing !== undefined) return existing
  const opening = openDomain(facility)
  openedDomains.set(facility, opening)
  opening.catch(() => {
    if (openedDomains.get(facility) === opening) openedDomains.delete(facility)
  })
  return opening
}

const closeUsageDomain = async (ctx: Context): Promise<void> => {
  const facility = facilityOf(ctx)
  if (facility === undefined) return
  const opening = openedDomains.get(facility)
  openedDomains.delete(facility)
  const domain = await opening?.catch(() => undefined)
  await domain?.close()
}

const defaultUsageMeta = (): UsageMeta => usageMetaSchema.parse({})

const readUsageHistorySettings = async (ctx: Context): Promise<UsageMeta> => {
  const opening = usageDomain(ctx)
  if (opening === undefined) return defaultUsageMeta()
  const domain = await opening
  return domain.global.get()
}

const saveUsageHistorySettings = async (ctx: Context, settings: UsageHistorySettings): Promise<UsageMeta> => {
  const opening = usageDomain(ctx)
  if (opening === undefined) throw new Error('Usage history storage is unavailable.')
  const domain = await opening
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
const collectUsageHistory = async (ctx: Context, accounts: readonly AccountProfile[], readUsage: AccountUsageReader, signal?: AbortSignal): Promise<number> => {
  const opening = usageDomain(ctx)
  if (opening === undefined) return 0
  const domain = await opening
  const quota = domain.table('quota')
  const settings = domain.global.get()

  let written = 0
  const enabled = accounts.filter(account => account.enabled)
  // Provider reads are independent, but bound concurrency to avoid an
  // unbounded burst of authenticated requests for profiles with many accounts.
  for (let offset = 0; offset < enabled.length; offset += PROVIDER_READ_CONCURRENCY) {
    if (signal?.aborted) break
    const batch = enabled.slice(offset, offset + PROVIDER_READ_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async account => {
        try {
          return { account, usage: signal?.aborted ? undefined : await readUsage(account, signal) }
        } catch {
          return { account, usage: undefined }
        }
      }),
    )
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
      await quota.put(UsageHistoryModel.bucketKey(account.instanceId, at, settings.intervalMinutes), snapshot)
      written += 1
    }
  }

  if (signal?.aborted) return written
  const attemptedAt = Date.now()
  // Re-read: a settings save during the sweep must not be overwritten by the
  // snapshot taken before it.
  await domain.global.set({
    ...domain.global.get(),
    lastAttemptAt: attemptedAt,
    ...(written > 0 ? { lastReadAt: attemptedAt } : {}),
  })
  return written
}

/** Oldest snapshot worth keeping, given the configured retention. */
const pruneUsageHistory = async (ctx: Context, retentionDays: number): Promise<number> => {
  const opening = usageDomain(ctx)
  if (opening === undefined) return 0
  const domain = await opening
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
const readUsageHistory = async (ctx: Context, instanceId: string, sinceMs: number): Promise<readonly QuotaSnapshot[]> => {
  const opening = usageDomain(ctx)
  if (opening === undefined) return []
  const domain = await opening
  const rows = [...domain.table('quota').entries()]
    .filter(([key, value]) => UsageHistoryModel.parseBucketKey(key)?.instanceId === instanceId && value.at >= sinceMs)
    .map(([, value]) => value)
    .map(value => ({ ...value, bankedResetExpiries: value.bankedResetExpiries ?? [] }))
  return UsageHistoryModel.boundPoints(rows)
}

export interface UsageHistoryScheduler {
  collectNow(): Promise<number>
  dispose(): void
}

/** Share one in-flight collection between the manual action and host timer. */
const createUsageHistoryScheduler = (
  ctx: Context,
  readAccounts: () => Promise<AccountsForCollection>,
  options: {
    readonly now?: () => number
    readonly readUsage?: AccountUsageReader
    readonly resolveCredential?: CredentialValueResolver
  } = {},
): UsageHistoryScheduler => {
  const now = options.now ?? Date.now
  let disposed = false
  let inFlight: Promise<number> | null = null
  let controller: AbortController | null = null

  const collectNow = (): Promise<number> => {
    if (disposed) return Promise.resolve(0)
    if (inFlight !== null) return inFlight
    const currentController = new AbortController()
    controller = currentController
    inFlight = (async () => {
      const source = await readAccounts()
      const recorded = await collectUsageHistory(
        ctx,
        source.accounts,
        options.readUsage ?? providerReader(source.shadowRoot, options.resolveCredential),
        currentController.signal,
      )
      if (currentController.signal.aborted) return recorded
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
    if (disposed || inFlight !== null || facilityOf(ctx) === undefined) return
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

export const createUsageHistoryService = (ctx: Context) => ({
  close: closeUsageDomain.bind(null, ctx),
  readSettings: readUsageHistorySettings.bind(null, ctx),
  saveSettings: saveUsageHistorySettings.bind(null, ctx),
  collect: collectUsageHistory.bind(null, ctx),
  prune: pruneUsageHistory.bind(null, ctx),
  read: readUsageHistory.bind(null, ctx),
  createScheduler: createUsageHistoryScheduler.bind(null, ctx),
})

export { USAGE_HISTORY_DOMAIN }
