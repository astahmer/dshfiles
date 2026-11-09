import type { ApiResourceOptions } from '@dshfiles/dshx/client'
import type { AnnotationStatus } from './schema.js'

/**
 * The composer action keeps a count badge for open annotations, so it needs a recent list even while its popover is
 * closed: the resource store polls it slowly, re-reads it when the page is shown again after 30 s, and polls it quickly
 * only while the popover can show the rows.
 */
const OPEN_POLL_MS = 4_000

export const annotationsListResource = { pollInterval: 60_000, staleTime: 30_000 } satisfies ApiResourceOptions<unknown>

const openStatuses: readonly AnnotationStatus[] = ['pending', 'acknowledged', 'stale']

/** The one list input the action and the pick form share, so both read and refresh the same resource key. */
export const annotationsListInput = ({ scope }: { readonly scope: string }) => ({
  sessionId: scope,
  statuses: [...openStatuses],
  limit: 50,
})

export const annotationsListPollMs = (popoverOpen: boolean): number | undefined => (popoverOpen ? OPEN_POLL_MS : undefined)
