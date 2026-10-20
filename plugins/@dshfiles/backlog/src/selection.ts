export const toggleBacklogSelection = (selected: ReadonlySet<number>, id: number): Set<number> => {
  const next = new Set(selected)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

export const extendBacklogSelection = (selected: ReadonlySet<number>, orderedIds: readonly number[], anchorId: number, targetId: number): Set<number> => {
  const anchorIndex = orderedIds.indexOf(anchorId)
  const targetIndex = orderedIds.indexOf(targetId)
  if (anchorIndex === -1 || targetIndex === -1) return new Set([targetId])
  const next = new Set(selected)
  for (const id of orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)) next.add(id)
  return next
}
