import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/**
 * The Session Controller rebuilds every summary object on each list projection, so
 * a row whose data did not change still arrives as a new object and invalidates
 * every memo downstream of it. Comparing field values and reusing the previous
 * object keeps each consumer's change set proportional to what actually changed.
 *
 * Every plugin that lists threads passes these selectors to its injected
 * `useSessions` / `useSessionStatus` hooks instead of an identity selector
 * (`state => state`).
 */

/** Structural equality for the JSON values a summary carries (projection values, retain counts). */
const sameJsonValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) if (!sameJsonValue(left.at(index), right.at(index))) return false
    return true
  }
  if (!(left instanceof Object) || !(right instanceof Object)) return false
  const rightFields = new Map(Object.entries(right))
  const leftFields = Object.entries(left)
  return leftFields.length === rightFields.size && leftFields.every(([key, value]) => rightFields.has(key) && sameJsonValue(value, rightFields.get(key)))
}

const sameSessionSummary = (left: SessionSummary, right: SessionSummary): boolean => left === right || sameJsonValue(left, right)

const sameIds = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right.at(index))

const stabilizeById = (
  previous: Readonly<Record<SessionId, SessionSummary>> | undefined,
  next: Readonly<Record<SessionId, SessionSummary>>,
): Readonly<Record<SessionId, SessionSummary>> => {
  // SAFETY: the keys of a record typed by SessionId are exactly that record's session ids.
  const ids = Object.keys(next) as SessionId[]
  const entries: [SessionId, SessionSummary][] = []
  let reused = previous !== undefined
  for (const id of ids) {
    const summary = next[id]
    if (summary === undefined) continue
    const before = previous?.[id]
    const stable = before !== undefined && sameSessionSummary(before, summary) ? before : summary
    if (stable !== before) reused = false
    entries.push([id, stable])
  }
  if (reused && Object.keys(previous ?? {}).length === entries.length) return previous ?? next
  return Object.fromEntries(entries)
}

const stabilizeProjections = (
  previous: SessionListState['projectionsBySession'] | undefined,
  next: SessionListState['projectionsBySession'],
): SessionListState['projectionsBySession'] => {
  if (previous === undefined) return next
  // SAFETY: the keys of a record typed by SessionId are exactly that record's session ids.
  const ids = Object.keys(next) as SessionId[]
  if (ids.length !== Object.keys(previous).length) return next
  const entries: [SessionId, SessionListState['projectionsBySession'][SessionId]][] = []
  let reused = true
  for (const id of ids) {
    const projection = next[id]
    if (projection === undefined) continue
    const before = previous[id]
    const stable = before !== undefined && sameJsonValue(before, projection) ? before : projection
    if (stable !== before) reused = false
    entries.push([id, stable])
  }
  return reused ? previous : Object.fromEntries(entries)
}

/** Reuse every unchanged summary, id list and projection map so one changed row invalidates one row. */
const stabilizeSessionListState = (previous: SessionListState | null, next: SessionListState): SessionListState => {
  if (previous === null) return next
  const byId = stabilizeById(previous.byId, next.byId)
  const ids = previous.ids === next.ids || sameIds(previous.ids, next.ids) ? previous.ids : next.ids
  const projectionsBySession = stabilizeProjections(previous.projectionsBySession, next.projectionsBySession)
  if (byId === previous.byId && ids === previous.ids && projectionsBySession === previous.projectionsBySession && next.phase === previous.phase) return previous
  return { ids, byId, phase: next.phase, projectionsBySession }
}

/** Reuse every unchanged status row; a status change for one session must not rebuild the others. */
const stabilizeStatusMap = <Status>(previous: ReadonlyMap<SessionId, Status> | null, next: ReadonlyMap<SessionId, Status>): ReadonlyMap<SessionId, Status> => {
  if (previous === null) return next
  if (previous.size !== next.size) return next
  const entries: [SessionId, Status][] = []
  let reused = true
  for (const [id, status] of next) {
    const before = previous.get(id)
    const stable = before !== undefined && sameJsonValue(before, status) ? before : status
    if (stable !== before) reused = false
    entries.push([id, stable])
  }
  return reused ? previous : new Map(entries)
}

const createStableSelector = <Snapshot extends object>(stabilize: (previous: Snapshot | null, next: Snapshot) => Snapshot): ((next: Snapshot) => Snapshot) => {
  // Keyed by the raw snapshot, so two components holding different generations in
  // the same tick each get one stable object instead of regenerating each other's.
  const stabilized = new WeakMap<Snapshot, Snapshot>()
  let lastStable: Snapshot | null = null
  return next => {
    const cached = stabilized.get(next)
    if (cached !== undefined) return cached
    const stable = stabilize(lastStable, next)
    stabilized.set(next, stable)
    lastStable = stable
    return stable
  }
}

/**
 * Selectors for the injected snapshot hooks: a projection that changed nothing
 * visible hands the previous snapshot object back, which stops the store
 * notification from re-rendering the consumer at all.
 */
const selectStableStatusMap = createStableSelector(stabilizeStatusMap)

export class HostSnapshotsModel {
  /** Main-view identity belongs to uiSession's current binding, never to retain-list ordering. */
  static readonly currentSessionOf = (sessions: readonly SessionSummary[], currentSessionId: string | undefined): SessionSummary | undefined =>
    sessions.find(session => session.id === currentSessionId)
  static readonly sameJsonValue = sameJsonValue
  static readonly sameSessionSummary = sameSessionSummary
  static readonly stabilizeSessionListState = stabilizeSessionListState
  static readonly stabilizeStatusMap = stabilizeStatusMap
  static readonly selectStableSessionListState = createStableSelector(stabilizeSessionListState)
  /** Selector for `useSessionStatus`; keeps the caller's status value type. */
  static readonly selectStableSessionStatus = <Status>(next: ReadonlyMap<SessionId, Status>): ReadonlyMap<SessionId, Status> =>
    // SAFETY: the cache returns `next` itself or a previous map whose every entry compared equal to `next`.
    selectStableStatusMap(next) as ReadonlyMap<SessionId, Status>
}
