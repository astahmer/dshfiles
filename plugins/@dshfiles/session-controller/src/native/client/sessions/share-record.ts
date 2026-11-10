// Structural sharing for the session list. Rows and projection snapshots are flat: every nested value
// (`retainedBy`, `projectionValues`, ...) is an immutable snapshot replaced on change, never mutated in place,
// so comparing fields by identity is exact. The manager's own entry cache relies on the same rule.

/** Same own keys holding the same values (`Object.is`). */
function shallowEqual<T extends object>(left: T, right: T): boolean {
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every(key => Object.hasOwn(right, key) && Object.is(left[key as keyof T], right[key as keyof T]))
}

/** Same length and the same elements in the same order (`Object.is`). */
export function sameArray<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
}

/**
 * A record holding the previous object for every entry whose fields did not change, so subscribers comparing
 * rows by identity skip them. Returns `previous` itself when no entry was added, removed or changed; never
 * modifies either argument.
 */
export function shareRecord<K extends string, V extends object>(previous: Readonly<Record<K, V>>, next: Readonly<Record<K, V>>): Readonly<Record<K, V>> {
  let changed = Object.keys(previous).length !== Object.keys(next).length
  const shared = {} as Record<K, V>
  for (const key of Object.keys(next) as K[]) {
    const value = next[key]
    const prior = previous[key] as V | undefined
    if (prior !== undefined && shallowEqual(prior, value)) shared[key] = prior
    else {
      shared[key] = value
      changed = true
    }
  }
  return changed ? shared : previous
}

interface ListSnapshot {
  ids: readonly string[]
  byId: Readonly<Record<string, object>>
  phase: unknown
  projectionsBySession: Readonly<Record<string, object>>
}

/**
 * The list snapshot to publish, reusing every unchanged part of `previous`, or `previous` itself when the
 * rebuild changed nothing; the caller then skips the set, so list consumers do not re-render.
 */
export function shareListSnapshot<S extends ListSnapshot>(previous: S, next: S): S {
  const sameIds = sameArray(previous.ids, next.ids)
  const byId = shareRecord(previous.byId, next.byId)
  const projectionsBySession = shareRecord(previous.projectionsBySession, next.projectionsBySession)
  if (sameIds && byId === previous.byId && projectionsBySession === previous.projectionsBySession && Object.is(next.phase, previous.phase)) {
    return previous
  }
  return { ...next, ids: sameIds ? previous.ids : next.ids, byId, projectionsBySession }
}
