/** The four-bar glyph names the effort level by how many bars it fills and which hue it takes. */
export type EffortTone = 'muted' | 'success' | 'warning'

export interface EffortGlyph {
  readonly filled: number
  readonly tone: EffortTone
}

export const EFFORT_BAR_COUNT = 4

const toneFor = (position: number): EffortTone => (position < 0.34 ? 'muted' : position < 0.8 ? 'success' : 'warning')

/**
 * Maps one level of a model's effort list onto the shared glyph: the lowest level fills one bar,
 * the highest all four, and the hue shifts from neutral to green to amber as effort rises.
 */
export const effortGlyph = ({ index, total }: { readonly index: number; readonly total: number }): EffortGlyph => {
  if (total <= 0) return { filled: 0, tone: 'muted' }
  const position = total === 1 ? 1 : Math.min(1, Math.max(0, index / (total - 1)))
  return { filled: Math.max(1, Math.round(position * (EFFORT_BAR_COUNT - 1)) + 1), tone: toneFor(position) }
}

/** The bar heights of the glyph, shortest first. */
export const EFFORT_BAR_HEIGHTS = [4, 7, 10, 13] as const
