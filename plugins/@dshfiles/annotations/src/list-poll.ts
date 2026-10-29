/**
 * The composer action keeps a count badge for open annotations, so it needs a
 * recent list even while its popover is closed. Poll it quickly only while the
 * popover can show the rows; otherwise rely on the slow safety poll plus the
 * focus refresh.
 */
const OPEN_POLL_MS = 4_000
const CLOSED_POLL_MS = 60_000

export const annotationsListPollMs = (popoverOpen: boolean): number => (popoverOpen ? OPEN_POLL_MS : CLOSED_POLL_MS)
