import type { StatusGlyphState } from '@dshfiles/plugin-ui/components/work-status'
import type { ThreadIntegrationCategory } from './thread-integration-state.js'

/**
 * Each land category in the shared status vocabulary (DESIGN.md: six states, colour only for Needs you and Failed).
 * The Land page kept a private tone table before: green for ready, amber for blocked. Ready is the ink dot, a
 * conflict is Failed, a blocked workspace needs you, an unverified one may be out of date, and landed is Done.
 */
const glyphs = {
  conflicts: 'failed',
  ready: 'ready',
  blocked: 'needs-you',
  unknown: 'stale',
  integrating: 'working',
  integrated: 'done',
  'no-changes': 'done',
} as const satisfies Record<ThreadIntegrationCategory, StatusGlyphState>

const glyph = (category: ThreadIntegrationCategory): StatusGlyphState => glyphs[category]

/**
 * The filters worth a seat: the two that are always a way out (the first and the last, "Needs you" and "All"), the one
 * selected, and every other only while it counts something. A row of zero-count filters is noise, not a status.
 */
const visibleFilters = <Filter extends string>(input: {
  readonly filters: readonly Filter[]
  readonly counts: Readonly<Record<Filter, number>>
  readonly selected: Filter
}): readonly Filter[] =>
  input.filters.filter((filter, index) => index === 0 || index === input.filters.length - 1 || filter === input.selected || input.counts[filter] > 0)

/** A count worth drawing: a zero is not drawn (DESIGN.md › Layout, counts). */
const drawnCount = (count: number): number | undefined => (count > 0 ? count : undefined)

export class LandStatusModel {
  static readonly glyph = glyph
  static readonly visibleFilters = visibleFilters
  static readonly drawnCount = drawnCount
}
