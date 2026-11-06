import type { ApiResourceOptions } from '@dshfiles/dshx/client'

/**
 * The composer action keeps a count badge for open annotations, so it needs a recent list even while its popover is
 * closed: the resource store polls it slowly, re-reads it when the page is shown again after 30 s, and polls it quickly
 * only while the popover can show the rows.
 */
const OPEN_POLL_MS = 4_000

export const annotationsListResource = { pollInterval: 60_000, staleTime: 30_000 } satisfies ApiResourceOptions<unknown>

export const annotationsListPollMs = (popoverOpen: boolean): number | undefined => (popoverOpen ? OPEN_POLL_MS : undefined)
