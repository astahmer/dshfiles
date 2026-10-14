interface ThreadRow {
  readonly id: string
  readonly blank: boolean
  readonly parentId?: string | undefined
  readonly origin?: 'subagent' | undefined
  readonly running: boolean
  readonly updatedAt: number
}

interface ShortcutRow {
  readonly id: string
  readonly label: string
  readonly keys: readonly string[]
  readonly aria: string | undefined
}

const RECENT_THREAD_LIMIT = 5

/** The threads the new-tab page suggests: top-level, not blank, running ones first, then the most recently updated. */
export const recentThreads = <Row extends ThreadRow>(rows: readonly Row[], isRunning: (row: Row) => boolean): Row[] =>
  rows
    .filter(row => !row.blank && row.parentId === undefined && row.origin !== 'subagent')
    .map(row => ({ row, running: isRunning(row) }))
    .sort((left, right) => Number(right.running) - Number(left.running) || right.row.updatedAt - left.row.updatedAt)
    .slice(0, RECENT_THREAD_LIMIT)
    .map(entry => entry.row)

/**
 * A panel has no command of its own in the shortcut catalog, so its shortcut is the bound command named after it
 * ("Jujutsu" or "Open Jujutsu"), if any.
 */
export const panelShortcut = <Row extends ShortcutRow>(catalog: readonly Row[], panelLabel: string): Row | undefined => {
  const names = new Set([panelLabel.toLowerCase(), `open ${panelLabel.toLowerCase()}`])
  return catalog.find(entry => entry.keys.length > 0 && names.has(entry.label.toLowerCase()))
}
