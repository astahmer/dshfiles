import * as Schema from 'effect/Schema'
import type { Suggestion } from './suggestions-model.js'

/** The suggestion shown prominently, and the local day it was first shown. */
export const featuredDaySchema = Schema.Struct({ day: Schema.String, rule: Schema.String })
export type FeaturedDay = typeof featuredDaySchema.Type

export interface SuggestionsView {
  /** Shown prominently: yesterday's pick while it still applies, else at most one new pick per local day. */
  readonly featured: Suggestion | null
  readonly rest: readonly Suggestion[]
  readonly dismissed: number
  /** What to store as the featured day, or `null` when the stored value already says it. */
  readonly remember: FeaturedDay | null
}

/** `YYYY-MM-DD` in the browser's own time zone. */
const localDay = (now: Date): string => `${String(now.getFullYear())}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

const pickFeatured = (input: { readonly active: readonly Suggestion[]; readonly featured: FeaturedDay | null; readonly today: string }): Suggestion | null => {
  const kept = input.active.find(suggestion => suggestion.rule === input.featured?.rule)
  if (kept !== undefined) return kept
  if (input.featured?.day === input.today) return null
  return input.active[0] ?? null
}

/** Dismissed suggestions never come back; the rest wait behind Show all suggestions. Dismissal is per browser. */
const view = (input: {
  readonly suggestions: readonly Suggestion[]
  readonly dismissed: readonly string[]
  readonly featured: FeaturedDay | null
  readonly today: string
}): SuggestionsView => {
  const dismissed = new Set(input.dismissed)
  const active = input.suggestions.filter(suggestion => !dismissed.has(suggestion.rule))
  const featured = pickFeatured({ active, featured: input.featured, today: input.today })
  const fresh = featured !== null && featured.rule !== input.featured?.rule
  return {
    featured,
    rest: active.filter(suggestion => suggestion !== featured),
    dismissed: input.suggestions.length - active.length,
    remember: fresh ? { day: input.today, rule: featured.rule } : null,
  }
}

export class SuggestionsWindow {
  static readonly localDay = localDay
  static readonly view = view
}
