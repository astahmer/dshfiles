/**
 * The phone status pill's summary (visual refresh P3 follow-up to T1.6): the pill reads what its first items say
 * ("1 working · Quota 56%") instead of a bare "Status". Items keep owning their text; the frame only reads the rendered
 * text of each, in the strip's order, and names an item by its label when its own text does not already say it.
 */

export interface StatusPart {
  /** The item's one-word label ("Working", "Quota"). */
  readonly label: string
  /** The item's rendered text; empty while it has nothing to say. */
  readonly text: string
}

/** How many items the pill names before the list holds the rest. */
const PILL_ITEMS = 2

const clean = (text: string): string => text.replace(/\s+/g, ' ').trim()

/**
 * Join the first items that have something to say.
 * @param parts - every visible item, in strip order (global side first).
 * @returns "1 working · Quota CC1 56%", or an empty string when no item has text.
 */
const summarize = (parts: readonly StatusPart[]): string =>
  parts
    .map(part => ({ label: clean(part.label), text: clean(part.text) }))
    .filter(part => part.text !== '')
    .slice(0, PILL_ITEMS)
    .map(part => (part.label === '' || part.text.toLowerCase().includes(part.label.toLowerCase()) ? part.text : `${part.label} ${part.text}`))
    .join(' · ')

export class StatusSummaryModel {
  static readonly summarize = summarize
}
