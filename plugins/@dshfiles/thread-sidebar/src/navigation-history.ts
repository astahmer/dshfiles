export const NAVIGATION_EVENT = 'dshfiles:thread-sidebar-navigate'

export type NavigationLocation<ThreadId extends string = string, PanelId extends string = string> =
  | { readonly kind: 'thread'; readonly id: ThreadId }
  | { readonly kind: 'panel'; readonly id: PanelId }

export interface NavigationHistory<Location extends NavigationLocation> {
  readonly entries: readonly Location[]
  /** Current entry; -1 while nothing has been visited. */
  readonly index: number
}

const NAVIGATION_HISTORY_LIMIT = 100

export class ThreadNavigationHistoryModel {
  static readonly emptyNavigationHistory = <Location extends NavigationLocation>(): NavigationHistory<Location> => ({ entries: [], index: -1 })

  static readonly sameLocation = (left: NavigationLocation, right: NavigationLocation): boolean => left.kind === right.kind && left.id === right.id

  /** An open panel covers the conversation, so it is the location; otherwise the selected thread is. */
  static readonly currentLocation = <ThreadId extends string, PanelId extends string>(options: {
    readonly panelId: PanelId | null
    readonly threadId: ThreadId | null
  }): NavigationLocation<ThreadId, PanelId> | null => {
    if (options.panelId !== null) return { kind: 'panel', id: options.panelId }
    if (options.threadId !== null) return { kind: 'thread', id: options.threadId }
    return null
  }

  /** Browser semantics: visiting drops the forward entries; revisiting the current entry is a no-op. */
  static readonly visitLocation = <Location extends NavigationLocation>(
    history: NavigationHistory<Location>,
    location: Location,
    limit: number = NAVIGATION_HISTORY_LIMIT,
  ): NavigationHistory<Location> => {
    const current = history.entries[history.index]
    if (current !== undefined && ThreadNavigationHistoryModel.sameLocation(current, location)) return history
    const entries = [...history.entries.slice(0, history.index + 1), location].slice(-limit)
    return { entries, index: entries.length - 1 }
  }

  static readonly canStep = (history: NavigationHistory<NavigationLocation>, direction: -1 | 1): boolean =>
    history.entries[history.index + direction] !== undefined && history.index >= 0

  /** Jump to any visited entry, as a browser's history menu does; null for the current entry or an unknown index. */
  static readonly jumpHistory = <Location extends NavigationLocation>(
    history: NavigationHistory<Location>,
    index: number,
  ): { readonly history: NavigationHistory<Location>; readonly target: Location } | null => {
    const target = history.entries[index]
    if (target === undefined || index === history.index || history.index < 0) return null
    return { history: { entries: history.entries, index }, target }
  }

  static readonly stepHistory = <Location extends NavigationLocation>(
    history: NavigationHistory<Location>,
    direction: -1 | 1,
  ): { readonly history: NavigationHistory<Location>; readonly target: Location } | null =>
    ThreadNavigationHistoryModel.jumpHistory(history, history.index + direction)
}
