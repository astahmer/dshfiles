import type { Context } from '@deepseek-ai/cordis'
import { readAccountUsage } from './account-usage.js'
import * as Schema from 'effect/Schema'
import { UsageHistoryModel, usageHistoryDomain } from './usage-history.js'
import { UsageHistoryStore } from './usage-history-store.js'
import { mapRollingUntilAborted } from './rolling-concurrency.js'
import { usageMetaSchema, type QuotaSnapshot, type UsageHistorySettings, type UsageMeta } from './usage-history-model.js'
import type { AccountProfile, UsageCard } from './api.js'
import type { CredentialValueResolver } from './credentials.js'
import { createCopilotCredentialsService } from './copilot-credentials.js'

type CopilotCredentialReader = ReturnType<typeof createCopilotCredentialsService>['read']

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
const PROVIDER_READ_CONCURRENCY = 4

export type AccountUsageReader = (account: AccountProfile, signal: AbortSignal | undefined) => Promise<UsageCard>

interface AccountsForCollection {
  readonly accounts: readonly AccountProfile[]
  readonly shadowRoot: string
}

const providerReader =
  (shadowRoot: string, resolveCredential: CredentialValueResolver | undefined, readCopilotCredential: CopilotCredentialReader): AccountUsageReader =>
  (account, signal) =>
    readAccountUsage({ account, shadowRoot, signal, resolveCredential, readCopilotCredential })

const facilityOf = (ctx: Context) => ctx.get('storageDomain')
type Facility = NonNullable<ReturnType<typeof facilityOf>>

/** One connection per database file, shared by every reader; the Host closes it on unload so a reload can open it again. */
const openedStores = new Map<string, Promise<UsageHistoryStore>>()

const importJsonHistory = async (facility: Facility, store: UsageHistoryStore): Promise<void> => {
  const domain = await facility.open(usageHistoryDomain)
  try {
    store.importJson({ settings: domain.global.get(), rows: domain.table('quota').entries() })
  } finally {
    await domain.close()
  }
}

const openStore = async (facility: Facility, filename: string): Promise<UsageHistoryStore> => {
  const store = UsageHistoryStore.open(filename)
  try {
    if (!store.jsonImported()) await importJsonHistory(facility, store)
    return store
  } catch (error) {
    store.close()
    throw error
  }
}

/** History needs the storage facility: the legacy JSON domain is imported through it before the first read. */
const usageStore = (ctx: Context): Promise<UsageHistoryStore> | undefined => {
  const facility = facilityOf(ctx)
  if (facility === undefined) return undefined
  const filename = UsageHistoryStore.defaultFilename()
  const existing = openedStores.get(filename)
  if (existing !== undefined) return existing
  const opening = openStore(facility, filename)
  openedStores.set(filename, opening)
  opening.catch(() => {
    if (openedStores.get(filename) === opening) openedStores.delete(filename)
  })
  return opening
}

const closeUsageStore = async (): Promise<void> => {
  const filename = UsageHistoryStore.defaultFilename()
  const opening = openedStores.get(filename)
  openedStores.delete(filename)
  const store = await opening?.catch(() => undefined)
  store?.close()
}

const defaultUsageMeta = (): UsageMeta => Schema.decodeUnknownSync(usageMetaSchema)({})

const settingsOf = (store: UsageHistoryStore): UsageMeta => store.settings() ?? defaultUsageMeta()

const readUsageHistorySettings = async (ctx: Context): Promise<UsageMeta> => {
  const opening = usageStore(ctx)
  if (opening === undefined) return defaultUsageMeta()
  return settingsOf(await opening)
}

const saveUsageHistorySettings = async (ctx: Context, settings: UsageHistorySettings): Promise<UsageMeta> => {
  const opening = usageStore(ctx)
  if (opening === undefined) throw new Error('Usage history storage is unavailable.')
  const store = await opening
  const next = Schema.decodeUnknownSync(usageMetaSchema)({ ...settingsOf(store), ...settings })
  store.saveSettings(next)
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
  const opening = usageStore(ctx)
  if (opening === undefined) return 0
  const store = await opening
  const settings = settingsOf(store)

  const enabled = accounts.filter(account => account.enabled)
  // Provider reads are independent, but bound concurrency to avoid an
  // unbounded burst of authenticated requests for profiles with many accounts.
  // Rolling: an account starts as soon as a slot frees, so one slow provider no
  // longer delays every account queued behind its batch.
  const results = await mapRollingUntilAborted({
    items: enabled,
    concurrency: PROVIDER_READ_CONCURRENCY,
    signal,
    map: async account => {
      let usage: UsageCard | undefined
      try {
        usage = signal?.aborted === true ? undefined : await readUsage(account, signal)
      } catch {
        usage = undefined
      }
      if (signal?.aborted === true || usage === undefined || usage.status !== 'ok') return 0
      const at = Date.now()
      const windows: Record<string, number> = {}
      const resetsAt: Record<string, number> = {}
      for (const window of usage.windows) {
        windows[window.label] = window.percentRemaining
        if (window.resetsAt !== null) resetsAt[window.label] = window.resetsAt
      }
      const reading: QuotaSnapshot = {
        at,
        instanceId: account.instanceId,
        windows,
        resetsAt,
        bankedResets: usage.bankedResets,
        bankedResetExpiries: usage.bankedResetExpiries,
      }
      const snapshot: QuotaSnapshot = usage.extraUsage === undefined ? reading : { ...reading, extraUsage: usage.extraUsage }
      store.put(UsageHistoryModel.bucketKey(account.instanceId, at, settings.intervalMinutes), snapshot)
      return 1
    },
  })
  let written = 0
  for (const result of results) written += result ?? 0

  if (signal?.aborted) return written
  const attemptedAt = Date.now()
  // Re-read: a settings save during the sweep must not be overwritten by the
  // snapshot taken before it.
  store.saveSettings({
    ...settingsOf(store),
    lastAttemptAt: attemptedAt,
    ...(written > 0 && { lastReadAt: attemptedAt }),
  })
  return written
}

/** Oldest snapshot worth keeping, given the configured retention. */
const pruneUsageHistory = async (ctx: Context, retentionDays: number): Promise<number> => {
  const opening = usageStore(ctx)
  if (opening === undefined) return 0
  return (await opening).prune(Date.now() - retentionDays * 24 * 60 * MINUTE_MS)
}

const readUsageHistories = async (
  ctx: Context,
  instanceIds: readonly string[],
  sinceMs: number,
  bucketMinutes?: number,
): Promise<readonly { readonly instanceId: string; readonly points: readonly QuotaSnapshot[] }[]> => {
  const opening = usageStore(ctx)
  if (opening === undefined) return instanceIds.map(instanceId => ({ instanceId, points: [] }))
  const stored = (await opening).read(instanceIds, sinceMs)
  const rowsByInstance = new Map(
    instanceIds.map(instanceId => [
      instanceId,
      (stored.get(instanceId) ?? []).map((value): QuotaSnapshot => {
        const point: QuotaSnapshot = {
          at: value.at,
          instanceId: value.instanceId,
          windows: value.windows,
          resetsAt: value.resetsAt,
          bankedResets: value.bankedResets,
          bankedResetExpiries: value.bankedResetExpiries ?? [],
        }
        return value.extraUsage === undefined ? point : { ...point, extraUsage: value.extraUsage }
      }),
    ]),
  )
  return instanceIds.map(instanceId => {
    const rows = rowsByInstance.get(instanceId) ?? []
    return {
      instanceId,
      points: UsageHistoryModel.boundPoints(bucketMinutes === undefined ? rows : UsageHistoryModel.thinPoints(rows, bucketMinutes)),
    }
  })
}

/** Readings for one account, oldest first, so a chart reads left to right. */
const readUsageHistory = async (ctx: Context, instanceId: string, sinceMs: number, bucketMinutes?: number): Promise<readonly QuotaSnapshot[]> =>
  (await readUsageHistories(ctx, [instanceId], sinceMs, bucketMinutes))[0]?.points ?? []

/** One full sweep: read every enabled account, store the readings, then prune past the retention window. */
const sweepUsageHistory =
  (
    ctx: Context,
    readAccounts: () => Promise<AccountsForCollection>,
    options: { readonly readUsage?: AccountUsageReader; readonly resolveCredential?: CredentialValueResolver } = {},
  ) =>
  async (signal: AbortSignal): Promise<number> => {
    const source = await readAccounts()
    const recorded = await collectUsageHistory(
      ctx,
      source.accounts,
      options.readUsage ?? providerReader(source.shadowRoot, options.resolveCredential, createCopilotCredentialsService(ctx.get('credentials')).read),
      signal,
    )
    if (signal.aborted) return recorded
    const settings = await readUsageHistorySettings(ctx)
    await pruneUsageHistory(ctx, settings.retentionDays)
    return recorded
  }

/** When the next scheduled sweep is due, or `undefined` while storage is unavailable. */
const nextSweepAt = async (ctx: Context): Promise<number | undefined> => {
  if (facilityOf(ctx) === undefined) return undefined
  const settings = await readUsageHistorySettings(ctx)
  const latestAttempt = settings.lastAttemptAt ?? settings.lastReadAt
  return latestAttempt === null ? 0 : latestAttempt + settings.intervalMinutes * MINUTE_MS
}

export const createUsageHistoryService = (ctx: Context) => ({
  close: closeUsageStore,
  readSettings: readUsageHistorySettings.bind(null, ctx),
  saveSettings: saveUsageHistorySettings.bind(null, ctx),
  collect: collectUsageHistory.bind(null, ctx),
  prune: pruneUsageHistory.bind(null, ctx),
  read: readUsageHistory.bind(null, ctx),
  readMany: readUsageHistories.bind(null, ctx),
  sweep: sweepUsageHistory.bind(null, ctx),
  nextSweepAt: nextSweepAt.bind(null, ctx),
})
