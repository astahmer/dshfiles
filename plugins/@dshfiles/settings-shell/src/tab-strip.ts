/** The row id `@dshfiles/main-tabs` registers its tab strip under. */
const MAIN_TABS_ENTRY_ID = 'dshfiles-main-tabs'

/**
 * The slots main-tabs has drawn its strip in: the frame's `shell.beforeMain` region today, `shell.overlay` before the
 * frame had one. Settings reads both, so its own close button goes whichever one a loaded main-tabs uses.
 */
export const TAB_STRIP_SLOTS = ['shell.beforeMain', 'shell.overlay'] as const

/**
 * Whether a tab strip is loaded. With one, the Settings tab carries the close button and the header draws none: a
 * second `×` beside it (and beside Back on a phone) closed the same page.
 */
export const tabStripLoaded = (entryIdsOf: (slot: (typeof TAB_STRIP_SLOTS)[number]) => readonly (string | undefined)[]): boolean =>
  TAB_STRIP_SLOTS.some(slot => entryIdsOf(slot).includes(MAIN_TABS_ENTRY_ID))
