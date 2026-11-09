import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
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

/** Own enumerable key count, without materializing a key array (this runs per row on every list publish). */
const ownKeyCount = <Value extends object>(value: Value): number => {
  let count = 0
  for (const key in value) if (Object.hasOwn(value, key)) count += 1
  return count
}

/** Field-by-field equality of two plain objects, skipping `ignoredKey`; allocation-free. */
const sameFields = <Value extends object>(left: Value, right: Value, ignoredKey: string | undefined): boolean => {
  let leftCount = 0
  for (const key in left) {
    if (!Object.hasOwn(left, key)) continue
    leftCount += 1
    if (key === ignoredKey) continue
    if (!Object.hasOwn(right, key) || !sameJsonValue(left[key], right[key])) return false
  }
  return leftCount === ownKeyCount(right)
}

/** Structural equality for the JSON values a summary carries (projection values, retain counts). */
const sameJsonValue = (left: unknown, right: unknown): boolean => {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    for (let index = 0; index < left.length; index += 1) if (!sameJsonValue(left[index], right[index])) return false
    return true
  }
  if (!(left instanceof Object) || !(right instanceof Object)) return false
  return sameFields(left, right, undefined)
}

/**
 * Retain counts are not presentation: which views hold a Session changes on every thread switch (main view, side
 * panel, kept views), and the thread on screen comes from uiSession's current binding. A row that differs only there
 * keeps its previous object, so a switch does not re-derive every list consumer.
 */
const sameSessionSummary = (left: SessionSummary, right: SessionSummary): boolean => left === right || sameFields(left, right, 'retainedBy')

const sameIds = (left: readonly SessionId[], right: readonly SessionId[]): boolean =>
  left.length === right.length && left.every((id, index) => id === right[index])

/**
 * Reuse unchanged rows of a record keyed by session id. The Session Controller client already keeps unchanged rows'
 * identity, so the common publish allocates nothing: `next` itself is returned, or `previous` when every row is
 * unchanged. A copy is made only to put back a previous row that arrived as an equal new object.
 */
const stabilizeRecord = <Row>(
  previous: Readonly<Record<SessionId, Row>> | undefined,
  next: Readonly<Record<SessionId, Row>>,
  same: (left: Row, right: Row) => boolean,
): Readonly<Record<SessionId, Row>> => {
  if (previous === undefined || previous === next) return next
  let restored: Record<SessionId, Row> | undefined
  let allPrevious = true
  let count = 0
  for (const key in next) {
    // SAFETY: the keys of a record typed by SessionId are exactly that record's session ids.
    const id = key as SessionId
    const row = next[id]
    if (row === undefined) continue
    count += 1
    const before = previous[id]
    if (before === row) continue
    if (before !== undefined && same(before, row)) {
      restored ??= { ...next }
      restored[id] = before
      continue
    }
    allPrevious = false
  }
  if (allPrevious && count === ownKeyCount(previous)) return previous
  return restored ?? next
}

/**
 * Whether two id-keyed records hold the same ids and every row matches on what `sameRow` compares, allocation-free. A
 * consumer that reads a few fields keys its memo on the record this keeps, so a publish that changed other fields (a
 * streaming turn's `updatedAt`, token usage) does not re-derive it.
 */
const sameRowsBy = <Row>(
  left: Readonly<Record<SessionId, Row>>,
  right: Readonly<Record<SessionId, Row>>,
  sameRow: (left: Row, right: Row) => boolean,
): boolean => {
  if (left === right) return true
  let count = 0
  for (const key in right) {
    // SAFETY: the keys of a record typed by SessionId are exactly that record's session ids.
    const id = key as SessionId
    const row = right[id]
    if (row === undefined) continue
    count += 1
    const before = left[id]
    if (before !== row && (before === undefined || !sameRow(before, row))) return false
  }
  return count === ownKeyCount(left)
}

/** Reuse every unchanged summary, id list and projection map so one changed row invalidates one row. */
const stabilizeSessionListState = (previous: SessionListState | null, next: SessionListState): SessionListState => {
  if (previous === null) return next
  const byId = stabilizeRecord(previous.byId, next.byId, sameSessionSummary)
  const ids = previous.ids === next.ids || sameIds(previous.ids, next.ids) ? previous.ids : next.ids
  const projectionsBySession = stabilizeRecord(previous.projectionsBySession, next.projectionsBySession, sameJsonValue)
  if (byId === previous.byId && ids === previous.ids && projectionsBySession === previous.projectionsBySession && next.phase === previous.phase) return previous
  if (byId === next.byId && ids === next.ids && projectionsBySession === next.projectionsBySession) return next
  return { ids, byId, phase: next.phase, projectionsBySession }
}

/** Reuse every unchanged status row; a status change for one session must not rebuild the others. */
const stabilizeStatusMap = <Status>(previous: ReadonlyMap<SessionId, Status> | null, next: ReadonlyMap<SessionId, Status>): ReadonlyMap<SessionId, Status> => {
  if (previous === null || previous === next) return next
  let restored: Map<SessionId, Status> | undefined
  let allPrevious = previous.size === next.size
  for (const [id, status] of next) {
    const before = previous.get(id)
    if (before === status) continue
    if (before !== undefined && sameJsonValue(before, status)) {
      restored ??= new Map(next)
      restored.set(id, before)
      continue
    }
    allPrevious = false
  }
  if (allPrevious) return previous
  return restored ?? next
}

/**
 * The workspace stream re-emits every item as a new object on each frame (a session attaching, a workspace touched), so
 * the list arrives new while a turn streams. The previous list is kept while every item carries the same content.
 */
const stabilizeWorkspaceItems = (previous: readonly WorkspaceView[] | null, next: readonly WorkspaceView[]): readonly WorkspaceView[] => {
  if (previous === null || previous === next || previous.length !== next.length) return next
  for (let index = 0; index < next.length; index += 1) if (previous[index] !== next[index] && !sameJsonValue(previous[index], next[index])) return next
  return previous
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
  static readonly sameRowsBy = sameRowsBy
  static readonly sameIds = sameIds
  static readonly stabilizeSessionListState = stabilizeSessionListState
  static readonly stabilizeStatusMap = stabilizeStatusMap
  static readonly selectStableSessionListState = createStableSelector(stabilizeSessionListState)
  static readonly selectStableWorkspaceItems = createStableSelector(stabilizeWorkspaceItems)
  /** Selector for `useSessionStatus`; keeps the caller's status value type. */
  static readonly selectStableSessionStatus = <Status>(next: ReadonlyMap<SessionId, Status>): ReadonlyMap<SessionId, Status> =>
    // SAFETY: the cache returns `next` itself or a previous map whose every entry compared equal to `next`.
    selectStableStatusMap(next) as ReadonlyMap<SessionId, Status>
}
