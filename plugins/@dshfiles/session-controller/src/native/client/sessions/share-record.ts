/** Same own keys holding the same values (`Object.is`); list rows and projection snapshots are flat. */
function shallowEqual<T extends object>(left: T, right: T): boolean {
  const leftKeys = Object.keys(left)
  if (leftKeys.length !== Object.keys(right).length) return false
  return leftKeys.every(key => Object.hasOwn(right, key) && Object.is(left[key as keyof T], right[key as keyof T]))
}

/**
 * Keep the previous object for every entry whose fields did not change, so subscribers comparing rows by
 * identity skip them. Returns `previous` itself when no entry was added, removed or changed.
 * @param previous - the record last published.
 * @param next - freshly built entries; unchanged ones are replaced in place by their previous object.
 */
export function shareRecord<K extends string, V extends object>(previous: Readonly<Record<K, V>>, next: Record<K, V>): Readonly<Record<K, V>> {
  let changed = Object.keys(previous).length !== Object.keys(next).length
  for (const key of Object.keys(next) as K[]) {
    const value = next[key]
    const prior = previous[key] as V | undefined
    if (prior !== undefined && shallowEqual(prior, value)) next[key] = prior
    else changed = true
  }
  return changed ? next : previous
}
