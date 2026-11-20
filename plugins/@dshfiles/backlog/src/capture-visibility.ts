import type { BacklogView } from './view-selection.js'

/**
 * Whether the capture box shows. Feed is the capture view and keeps it; every other view shows it only once New, `c`,
 * a column's "+" or a quote asked for it, so it never takes the height of the list or the item detail it would cover.
 */
export const captureVisible = (input: { readonly view: BacklogView; readonly requested: boolean }): boolean => input.view === 'feed' || input.requested
