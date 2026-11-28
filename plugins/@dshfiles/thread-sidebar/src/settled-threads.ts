/**
 * The settled status is two values read together: the ids, and when each was settled. The timestamp is what makes
 * both the banner's date and the archive delay possible, so it is written, pruned and read through the helpers here
 * rather than by hand at each call site. The Host keeps it in its own store (settled-store.ts); a Host started before
 * that store keeps it in two settings fields of the same names.
 */
export interface SettledStatus {
  readonly settledSessionIds: string[]
  readonly settledAt: Record<string, number>
}

export interface SettledSessionState {
  readonly running: boolean
  readonly pendingInteraction: boolean | undefined
  readonly updatedAt: number
}

/** Keep only the timestamps still backed by a settled id, so the settings document cannot grow. */
const withOnlySettledIds = (settledAt: Readonly<Record<string, number>>, settledSessionIds: readonly string[]): SettledStatus['settledAt'] => {
  const kept: Record<string, number> = {}
  for (const sessionId of settledSessionIds) {
    const at = settledAt[sessionId]
    if (at !== undefined) kept[sessionId] = at
  }
  return kept
}

/** Settle threads, keeping the first settle instant of an id that is already settled. */
const settle = (status: SettledStatus, sessionIds: readonly string[], now: number): SettledStatus => {
  if (sessionIds.length === 0) return status
  const settledSessionIds = [...new Set([...status.settledSessionIds, ...sessionIds])]
  const settledAt = { ...status.settledAt }
  for (const sessionId of sessionIds) if (settledAt[sessionId] === undefined) settledAt[sessionId] = now
  return { settledSessionIds, settledAt: withOnlySettledIds(settledAt, settledSessionIds) }
}

const unsettle = (status: SettledStatus, sessionIds: readonly string[]): SettledStatus => {
  if (sessionIds.length === 0) return status
  const dropped = new Set(sessionIds)
  const settledSessionIds = status.settledSessionIds.filter(sessionId => !dropped.has(sessionId))
  return { settledSessionIds, settledAt: withOnlySettledIds(status.settledAt, settledSessionIds) }
}

export interface SettleAndUnparkInput {
  readonly status: SettledStatus
  readonly parkedSessionIds: readonly string[]
  readonly sessionIds: readonly string[]
  readonly now: number
}

export interface SettledPreferences extends SettledStatus {
  readonly parkedSessionIds: string[]
}

/**
 * Settling a thread drops its parked mark in the same write. Park means "not now" and settle means
 * "nothing wakes it"; a settled thread belongs in Settled, never in Parked, so the two cannot hold
 * the same id. Unsettling leaves park alone instead of restoring a mark this settle removed.
 */
const settleAndUnpark = (input: SettleAndUnparkInput): SettledPreferences => {
  const settled = settle(input.status, input.sessionIds, input.now)
  if (input.sessionIds.length === 0) return { ...settled, parkedSessionIds: [...input.parkedSessionIds] }
  const targets = new Set(input.sessionIds)
  return { ...settled, parkedSessionIds: input.parkedSessionIds.filter(sessionId => !targets.has(sessionId)) }
}

/** When the sidebar will archive a settled thread, or undefined while no delay will do it. */
const archiveTime = (input: { readonly settledAt: number | undefined; readonly delayMs: number }): number | undefined =>
  input.settledAt === undefined || !Number.isFinite(input.delayMs) ? undefined : input.settledAt + input.delayMs

/**
 * Settled threads whose archive delay has passed and whose thread is still quiet: an archived,
 * pinned, running, waiting or newly changed thread is left alone. A settled id with no recorded
 * instant (settled before this policy existed) never becomes due.
 */
const dueArchiveSessionIds = (input: {
  readonly status: SettledStatus
  readonly sessions: ReadonlyMap<string, SettledSessionState>
  readonly archivedSessionIds: ReadonlySet<string>
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly now: number
  readonly delayMs: number
}): readonly string[] => {
  if (!Number.isFinite(input.delayMs)) return []
  const due: string[] = []
  for (const sessionId of input.status.settledSessionIds) {
    const settledAt = input.status.settledAt[sessionId]
    if (settledAt === undefined || input.now < settledAt + input.delayMs) continue
    if (input.archivedSessionIds.has(sessionId) || input.pinnedSessionIds.has(sessionId)) continue
    const session = input.sessions.get(sessionId)
    if (session === undefined || session.running || session.pendingInteraction !== false || session.updatedAt > settledAt) continue
    due.push(sessionId)
  }
  return due
}

const unpinSettledThreads = async (input: {
  readonly sessionIds: readonly string[]
  readonly pinnedSessionIds: ReadonlySet<string>
  readonly unpin: (sessionId: string) => Promise<void>
}): Promise<void> => {
  await Promise.all(input.sessionIds.filter(sessionId => input.pinnedSessionIds.has(sessionId)).map(input.unpin))
}

/**
 * Settled ids that are archived now, so their settled status can go. While an auto-archive scan runs, each thread it
 * archives would otherwise rewrite the whole settled status (every id and instant) once; waiting for the scan to end
 * clears them all in one write.
 */
const archivedStillSettled = (input: {
  readonly settledSessionIds: readonly string[]
  readonly archivedSessionIds: ReadonlySet<string>
  readonly autoArchiveRunning: boolean
}): readonly string[] => (input.autoArchiveRunning ? [] : input.settledSessionIds.filter(sessionId => input.archivedSessionIds.has(sessionId)))

/**
 * The change one settled-status write makes, from the status a page read and the full status it wants next: the ids to
 * settle (with their instant) and to restore. Sending the change instead of the whole status keeps a settle the Host
 * made meanwhile.
 */
export interface SettledStatusChange {
  readonly settle: Record<string, number | null>
  readonly unsettle: string[]
}

const changeBetween = (current: SettledStatus, next: SettledStatus): SettledStatusChange => {
  const before = new Set(current.settledSessionIds)
  const after = new Set(next.settledSessionIds)
  const settle: Record<string, number | null> = {}
  for (const sessionId of after) if (!before.has(sessionId)) settle[sessionId] = next.settledAt[sessionId] ?? null
  return { settle, unsettle: [...before].filter(sessionId => !after.has(sessionId)) }
}

/** Apply such a change: restore first, then settle, keeping the first instant of a thread already settled. */
/** A change as the wire delivers it: read-only maps and lists. */
export interface SettledStatusChangeInput {
  readonly settle: Readonly<Record<string, number | null>>
  readonly unsettle: readonly string[]
}

const applyChange = (status: SettledStatus, change: SettledStatusChangeInput): SettledStatus => {
  const restored = unsettle(status, change.unsettle)
  const settledAt = { ...restored.settledAt }
  for (const [sessionId, at] of Object.entries(change.settle)) if (settledAt[sessionId] === undefined && at !== null) settledAt[sessionId] = at
  const settledSessionIds = [...new Set([...restored.settledSessionIds, ...Object.keys(change.settle)])]
  return { settledSessionIds, settledAt: withOnlySettledIds(settledAt, settledSessionIds) }
}

export class SettledThreadsModel {
  static readonly changeBetween = changeBetween
  static readonly applyChange = applyChange
  static readonly archivedStillSettled = archivedStillSettled
  static readonly settle = settle
  static readonly unpinSettledThreads = unpinSettledThreads
  static readonly settleAndUnpark = settleAndUnpark
  static readonly unsettle = unsettle
  static readonly archiveTime = archiveTime
  static readonly dueArchiveSessionIds = dueArchiveSessionIds
}
