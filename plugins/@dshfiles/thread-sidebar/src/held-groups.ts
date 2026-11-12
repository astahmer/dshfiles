/**
 * The thread list holds its order while the pointer is over it or focus is in it (plan Q2 T2.2): a thread that finishes
 * or wakes does not jump to another group under J/K or the pointer. While held, each group keeps the rows it had, in
 * the order it had them, drawn with fresh row data; rows that left disappear; new or moved rows wait behind an
 * "N updates" pill until the list is released or the pill is pressed.
 */
export interface HeldGroups {
  readonly groups: readonly { readonly key: string; readonly ids: readonly string[] }[]
}

interface Grouped<Thread> {
  readonly key: string
  readonly threads: readonly Thread[]
}

const capture = <Thread>(groups: readonly Grouped<Thread>[], idOf: (thread: Thread) => string): HeldGroups => ({
  groups: groups.map(group => ({ key: group.key, ids: group.threads.map(idOf) })),
})

const apply = <Thread, Group extends Grouped<Thread>>(
  groups: readonly Group[],
  held: HeldGroups | null,
  idOf: (thread: Thread) => string,
): readonly Group[] => {
  if (held === null) return groups
  const live = new Map<string, Thread>()
  for (const group of groups) for (const thread of group.threads) live.set(idOf(thread), thread)
  const byKey = new Map(groups.map(group => [group.key, group]))
  return held.groups.flatMap(heldGroup => {
    const template = byKey.get(heldGroup.key) ?? groups[0]
    if (template === undefined) return []
    const threads = heldGroup.ids.flatMap(id => {
      const thread = live.get(id)
      return thread === undefined ? [] : [thread]
    })
    // A held group that is gone from the live list keeps its rows under the live group's look-alike shape.
    return [{ ...template, key: heldGroup.key, threads }]
  })
}

/** Rows the held order hides or would move: rows new to the list plus rows whose group or place changed. */
const pending = <Thread>(groups: readonly Grouped<Thread>[], held: HeldGroups | null, idOf: (thread: Thread) => string): number => {
  if (held === null) return 0
  const heldPlace = new Map<string, string>()
  for (const group of held.groups) group.ids.forEach((id, index) => heldPlace.set(id, `${group.key}\u0000${String(index)}`))
  let count = 0
  for (const group of groups) {
    const heldIds = new Set(held.groups.find(candidate => candidate.key === group.key)?.ids ?? [])
    const kept = group.threads.map(idOf).filter(id => heldIds.has(id))
    for (const thread of group.threads) {
      const id = idOf(thread)
      if (!heldPlace.has(id)) count += 1
      else if (!heldIds.has(id)) count += 1
    }
    const heldOrder = (held.groups.find(candidate => candidate.key === group.key)?.ids ?? []).filter(id => kept.includes(id))
    count += kept.filter((id, index) => heldOrder[index] !== id).length
  }
  return count
}

export const HeldGroupsModel = { capture, apply, pending } as const
