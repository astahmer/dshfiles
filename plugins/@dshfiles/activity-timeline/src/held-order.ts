/**
 * A list that holds its order while the user works in it (plan Q2 T2.2): rows never move under the pointer or the
 * keyboard highlight. While held, rows keep their places, rows that left disappear, and new rows wait behind an
 * "N updates" pill until the list is released or the pill is pressed.
 */
const hold = <T extends { readonly id: string }>(items: readonly T[], held: readonly string[] | null): readonly T[] => {
  if (held === null) return items
  const byId = new Map(items.map(item => [item.id, item]))
  return held.flatMap(id => {
    const item = byId.get(id)
    return item === undefined ? [] : [item]
  })
}

/** How many live rows the held order hides or would move: new rows plus rows whose place changed. */
const pending = (live: readonly string[], held: readonly string[] | null): number => {
  if (held === null) return 0
  const kept = new Set(held)
  const fresh = live.filter(id => !kept.has(id)).length
  const stillThere = held.filter(id => live.includes(id))
  const liveOrder = live.filter(id => kept.has(id))
  const moved = stillThere.filter((id, index) => liveOrder[index] !== id).length
  return fresh + moved
}

export const HeldOrder = { hold, pending } as const
