/** Move one host id to an index, keeping every other id in its relative order. */
export const moveHostId = ({ ids, id, toIndex }: { readonly ids: readonly string[]; readonly id: string; readonly toIndex: number }): readonly string[] => {
  const fromIndex = ids.indexOf(id)
  if (fromIndex === -1) return ids
  const bounded = Math.max(0, Math.min(toIndex, ids.length - 1))
  if (fromIndex === bounded) return ids
  const next = [...ids]
  next.splice(fromIndex, 1)
  next.splice(bounded, 0, id)
  return next
}

/** Move one host one slot up or down; a host already at that end keeps the order. */
export const shiftHostId = ({
  ids,
  id,
  direction,
}: {
  readonly ids: readonly string[]
  readonly id: string
  readonly direction: 'up' | 'down'
}): readonly string[] => {
  const index = ids.indexOf(id)
  if (index === -1) return ids
  return moveHostId({ ids, id, toIndex: index + (direction === 'up' ? -1 : 1) })
}
