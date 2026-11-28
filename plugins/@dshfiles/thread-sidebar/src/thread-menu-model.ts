/**
 * The one menu of a thread: which verbs it holds, in which order and under which submenu. The row menu of the thread
 * list and the thread header's `⋯` both render this layout, so a verb has one place, one label and one icon whichever
 * way the menu was opened (DESIGN.md: one `⋯` per thread; docs/ade-ux §4.3: lifecycle verbs identical everywhere).
 *
 * A surface offers the entries it can run; an entry it cannot run there is left out instead of shown disabled: the list
 * has no Find in thread for a thread that is not on screen, a phone has no side panel, and an archived thread only
 * offers what still applies to it. Pure, so the layout is tested without rendering a menu.
 */

/** Verbs at the top level: the lifecycle verbs and the three a supervisor reaches for most. */
export const THREAD_MENU_TOP = ['find', 'pin', 'done', 'snooze', 'restore', 'rename', 'side-panel', 'copy-link'] as const

/** "Open in": every other place the thread, or a view of it, can open. */
export const THREAD_MENU_OPEN_IN = ['thread-views', 'side-panel-views', 'continue-in', 'native-open-in'] as const

/** "Copy": what goes to the clipboard besides the link. */
export const THREAD_MENU_COPY = ['copy-id', 'copy-markdown'] as const

/**
 * "More", in clusters a separator divides: long-thread tools, using the thread from another one, alerts and read
 * state, the per-thread settings, what refers to it and what other plugins add, then Archive last and apart.
 */
export const THREAD_MENU_MORE = [
  ['turns'],
  ['mention', 'follow-up'],
  ['mute', 'mark-unread', 'notify', 'keep-awake'],
  ['auto-done', 'move-to-group'],
  ['referenced-by', 'turn-into-project', 'sections', 'row-actions', 'native-actions'],
  ['archive'],
] as const

export type ThreadMenuTopId = (typeof THREAD_MENU_TOP)[number]
export type ThreadMenuOpenInId = (typeof THREAD_MENU_OPEN_IN)[number]
export type ThreadMenuCopyId = (typeof THREAD_MENU_COPY)[number]
export type ThreadMenuMoreId = (typeof THREAD_MENU_MORE)[number][number]
export type ThreadMenuEntryId = ThreadMenuTopId | ThreadMenuOpenInId | ThreadMenuCopyId | ThreadMenuMoreId

/** What still applies to an archived thread: bring it back, refer to it, read what refers to it. */
const ARCHIVED_ENTRIES: ReadonlySet<ThreadMenuEntryId> = new Set<ThreadMenuEntryId>([
  'find',
  'turns',
  'thread-views',
  'restore',
  'copy-link',
  'copy-id',
  'copy-markdown',
  'mention',
  'follow-up',
  'mute',
  'mark-unread',
  'notify',
  'keep-awake',
  'auto-done',
  'move-to-group',
  'referenced-by',
  'sections',
  'row-actions',
  'native-actions',
  'rename',
])

/** Entries that need a second pane beside the thread, which a phone does not have. */
const SIDE_PANEL_ENTRIES: ReadonlySet<ThreadMenuEntryId> = new Set<ThreadMenuEntryId>(['side-panel', 'side-panel-views'])

export interface ThreadMenuLayoutInput {
  /** The entries this surface can run for this thread. */
  readonly offered: ReadonlySet<ThreadMenuEntryId>
  readonly archived: boolean
  /** The phone shell: one pane, so nothing opens beside the thread. */
  readonly phone: boolean
}

export interface ThreadMenuLayout {
  readonly top: readonly ThreadMenuTopId[]
  readonly openIn: readonly ThreadMenuOpenInId[]
  readonly copy: readonly ThreadMenuCopyId[]
  /** Non-empty clusters only; the menu draws a separator between two of them. */
  readonly more: readonly (readonly ThreadMenuMoreId[])[]
}

const layout = (input: ThreadMenuLayoutInput): ThreadMenuLayout => {
  const shown = (id: ThreadMenuEntryId): boolean => {
    if (!input.offered.has(id)) return false
    if (input.phone && SIDE_PANEL_ENTRIES.has(id)) return false
    // Restore is the archived thread's one lifecycle verb; a live thread restores from Done through the Done entry.
    if (id === 'restore') return input.archived
    return !input.archived || ARCHIVED_ENTRIES.has(id)
  }
  return {
    top: THREAD_MENU_TOP.filter(shown),
    openIn: THREAD_MENU_OPEN_IN.filter(shown),
    copy: THREAD_MENU_COPY.filter(shown),
    more: THREAD_MENU_MORE.map(cluster => cluster.filter(shown)).filter(cluster => cluster.length > 0),
  }
}

/** How many rows the menu shows before any submenu opens: its top verbs plus one row per non-empty submenu. */
const topLevelCount = (menu: ThreadMenuLayout): number =>
  menu.top.length + (menu.openIn.length > 0 ? 1 : 0) + (menu.copy.length > 0 ? 1 : 0) + (menu.more.length > 0 ? 1 : 0)

/**
 * A single-letter key hint ("P", "E", "H", "U") names a key of the thread list on a keyboard; a touch device has no
 * such key, so its menu shows none. Chords stay out too: there is no ⌘ on a phone.
 */
const keyHint = (keys: string | undefined, coarsePointer: boolean): string | undefined => (coarsePointer ? undefined : keys)

/**
 * Keep screen on (plan phone P27): a phone watching a long run keeps its screen awake from the thread menu. The lock is
 * the page's, so the entry names what a tap does next; a desktop pointer, or a browser without Screen Wake Lock, gets no
 * entry rather than a switch that cannot hold.
 */
const keepAwakeLabel = (input: {
  readonly coarsePointer: boolean
  readonly available: boolean
  readonly on: boolean
}): 'threadSidebarKeepScreenOn' | 'threadSidebarAllowScreenSleep' | undefined => {
  if (!input.coarsePointer || !input.available) return undefined
  return input.on ? 'threadSidebarAllowScreenSleep' : 'threadSidebarKeepScreenOn'
}

export class ThreadMenuModel {
  static readonly layout = layout
  static readonly topLevelCount = topLevelCount
  static readonly keyHint = keyHint
  static readonly keepAwakeLabel = keepAwakeLabel
}
