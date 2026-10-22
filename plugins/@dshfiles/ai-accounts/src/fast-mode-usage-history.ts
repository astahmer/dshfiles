import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import {
  FastModeUsageModel,
  fastModeUsageEventSchema,
  fastModeUsageObservationSchema,
  type FastModeUsageHistory,
  type FastModeUsageObservation,
} from './fast-mode-usage-model.js'

const DAY_MS = 24 * 60 * 60_000
const MAX_FAST_MODE_EVENTS = 10_000
const MAX_RETENTION_DAYS = 365

export const fastModeUsageDomain = defineDomain({
  name: 'ai_accounts_fastmode',
  version: 1,
  layout: 'per-record',
  invalidRecords: 'backup-and-skip',
  tables: {
    events: { valueSchema: fastModeUsageEventSchema, __key: 'eventId' },
  },
})

const facilityOf = (ctx: Context) => ctx.get('storageDomain')
type Facility = NonNullable<ReturnType<typeof facilityOf>>
const openDomain = (facility: Facility) => facility.open(fastModeUsageDomain)
type FastModeUsageDomain = Awaited<ReturnType<typeof openDomain>>

const openedDomains = new WeakMap<Facility, Promise<FastModeUsageDomain>>()

const domainOf = (ctx: Context): Promise<FastModeUsageDomain> | undefined => {
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

const pruneDomain = async (domain: FastModeUsageDomain, retentionDays: number, now: number): Promise<number> => {
  const events = domain.table('events')
  const entries = [...events.entries()].sort((left, right) => left[1].at - right[1].at)
  const cutoff = now - Math.min(MAX_RETENTION_DAYS, Math.max(1, retentionDays)) * DAY_MS
  const removeCount = Math.max(0, entries.length - MAX_FAST_MODE_EVENTS)
  const remove = entries.filter(([, event], index) => event.at < cutoff || index < removeCount)
  for (const [eventId] of remove) await events.delete(eventId)
  return remove.length
}

export const createFastModeUsageHistoryService = (
  ctx: Context,
  options: { readonly readRetentionDays: () => Promise<number>; readonly now?: () => number },
) => {
  const now = options.now ?? Date.now
  let writesSincePrune = 0

  const close = async (): Promise<void> => {
    const facility = facilityOf(ctx)
    if (facility === undefined) return
    const opening = openedDomains.get(facility)
    openedDomains.delete(facility)
    const domain = await opening?.catch(() => undefined)
    await domain?.close()
  }

  const record = async (input: FastModeUsageObservation): Promise<void> => {
    const opening = domainOf(ctx)
    if (opening === undefined) return
    const domain = await opening
    const event = fastModeUsageEventSchema.parse({ ...fastModeUsageObservationSchema.parse(input), at: now() })
    await domain.table('events').put(randomUUID(), event)
    writesSincePrune += 1
    if (writesSincePrune < 100) return
    writesSincePrune = 0
    await pruneDomain(domain, await options.readRetentionDays(), now())
  }

  const read = async (instanceId: string, since: number): Promise<FastModeUsageHistory> => {
    const opening = domainOf(ctx)
    if (opening === undefined) return { points: [] }
    const domain = await opening
    const nowAtRead = now()
    const retainedSince = Math.max(since, nowAtRead - Math.min(MAX_RETENTION_DAYS, Math.max(1, await options.readRetentionDays())) * DAY_MS)
    const events = [...domain.table('events').entries()]
      .map(([, event]) => event)
      .filter(event => event.instanceId === instanceId && event.at >= retainedSince && event.at <= nowAtRead)
    return FastModeUsageModel.aggregate(events, FastModeUsageModel.bucketWidth(since, nowAtRead))
  }

  const prune = async (retentionDays: number): Promise<number> => {
    const opening = domainOf(ctx)
    if (opening === undefined) return 0
    return pruneDomain(await opening, retentionDays, now())
  }

  return { close, record, read, prune }
}

export type FastModeUsageHistoryService = ReturnType<typeof createFastModeUsageHistoryService>
export type { FastModeUsageEvent, FastModeUsageObservation } from './fast-mode-usage-model.js'
