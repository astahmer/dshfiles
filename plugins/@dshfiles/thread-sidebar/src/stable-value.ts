import { useRef } from 'react'

/**
 * Identity helpers for values rebuilt on every sidebar render. A derived set or map
 * that carries the same content must keep its previous reference, or every row that
 * receives it re-renders although nothing it shows changed.
 */

const sameSet = <Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean => {
  if (left === right) return true
  if (left.size !== right.size) return false
  for (const value of left) if (!right.has(value)) return false
  return true
}

const sameMap = <Key, Value>(left: ReadonlyMap<Key, Value>, right: ReadonlyMap<Key, Value>): boolean => {
  if (left === right) return true
  if (left.size !== right.size) return false
  for (const [key, value] of left) if (!Object.is(right.get(key), value)) return false
  return true
}

/** Keep `previous` while `next` carries the same content, so memos downstream survive a rebuilt pass. */
const keepStable = <Value>(previous: Value | undefined, next: Value, same: (left: Value, right: Value) => boolean): Value =>
  previous !== undefined && same(previous, next) ? previous : next

export class StableValueModel {
  static readonly sameSet = sameSet
  static readonly sameMap = sameMap
  static readonly keepStable = keepStable
}

/** Hold the previous value for this component while `next` stays equal to it. */
export const useStableValue = <Value>(next: Value, same: (left: Value, right: Value) => boolean): Value => {
  const stable = useRef(next)
  stable.current = keepStable(stable.current, next, same)
  return stable.current
}
