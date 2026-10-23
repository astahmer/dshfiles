/** Multi-select over backlog rows: Cmd/Ctrl toggles, Shift extends the inclusive range from the anchor. */
export class BacklogSelection {
  static readonly toggle = (selected: ReadonlySet<number>, id: number): Set<number> => {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }

  static readonly extend = (selected: ReadonlySet<number>, orderedIds: readonly number[], anchorId: number, targetId: number): Set<number> => {
    const anchorIndex = orderedIds.indexOf(anchorId)
    const targetIndex = orderedIds.indexOf(targetId)
    if (anchorIndex === -1 || targetIndex === -1) return new Set([targetId])
    const next = new Set(selected)
    for (const id of orderedIds.slice(Math.min(anchorIndex, targetIndex), Math.max(anchorIndex, targetIndex) + 1)) next.add(id)
    return next
  }

  /**
   * The selection a Cmd/Shift-click starts from. The open item is highlighted like a selected one, so a modifier click
   * with nothing selected yet includes it.
   */
  static readonly seed = (selected: ReadonlySet<number>, openId: number | null): ReadonlySet<number> =>
    selected.size === 0 && openId !== null ? new Set([openId]) : selected
}
