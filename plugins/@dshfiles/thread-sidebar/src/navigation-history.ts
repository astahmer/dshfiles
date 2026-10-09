export const NAVIGATION_EVENT = 'dshfiles:thread-sidebar-navigate'

export type NavigationLocation<ThreadId extends string = string, PanelId extends string = string> =
  | { readonly kind: 'thread'; readonly id: ThreadId }
  | { readonly kind: 'panel'; readonly id: PanelId }

export interface NavigationHistory<Location extends NavigationLocation> {
  readonly entries: readonly Location[]
  /** Current entry; -1 while nothing has been visited. */
  readonly index: number
}

export const NAVIGATION_HISTORY_LIMIT = 100

export const emptyNavigationHistory = <Location extends NavigationLocation>(): NavigationHistory<Location> => ({ entries: [], index: -1 })

export const sameLocation = (left: NavigationLocation, right: NavigationLocation): boolean => left.kind === right.kind && left.id === right.id

/** An open panel covers the conversation, so it is the location; otherwise the selected thread is. */
export const currentLocation = <ThreadId extends string, PanelId extends string>(options: {
  readonly panelId: PanelId | null
  readonly threadId: ThreadId | null
}): NavigationLocation<ThreadId, PanelId> | null => {
  if (options.panelId !== null) return { kind: 'panel', id: options.panelId }
  if (options.threadId !== null) return { kind: 'thread', id: options.threadId }
  return null
}

/** Browser semantics: visiting drops the forward entries; revisiting the current entry is a no-op. */
export const visitLocation = <Location extends NavigationLocation>(
  history: NavigationHistory<Location>,
  location: Location,
  limit: number = NAVIGATION_HISTORY_LIMIT,
): NavigationHistory<Location> => {
  const current = history.entries[history.index]
  if (current !== undefined && sameLocation(current, location)) return history
  const entries = [...history.entries.slice(0, history.index + 1), location].slice(-limit)
  return { entries, index: entries.length - 1 }
}

export const canStep = (history: NavigationHistory<NavigationLocation>, direction: -1 | 1): boolean =>
  history.entries[history.index + direction] !== undefined && history.index >= 0

export const stepHistory = <Location extends NavigationLocation>(
  history: NavigationHistory<Location>,
  direction: -1 | 1,
): { readonly history: NavigationHistory<Location>; readonly target: Location } | null => {
  if (!canStep(history, direction)) return null
  const index = history.index + direction
  const target = history.entries[index]
  return target === undefined ? null : { history: { entries: history.entries, index }, target }
}
