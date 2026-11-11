import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'
import { featuredDaySchema, type FeaturedDay } from './suggestions-window.js'

/** Presentation only, per browser: which suggestion was featured on which day, and which ones the user dismissed. */
const featured = createStoredValue({ key: 'dshfiles.onboarding.suggestions.featured.v1', schema: Schema.NullOr(featuredDaySchema), fallback: null })
const dismissed = createStoredValue({ key: 'dshfiles.onboarding.suggestions.dismissed.v1', schema: Schema.Array(Schema.String), fallback: [] })

export class SuggestionsStore {
  static readonly useFeatured = (): FeaturedDay | null => featured.useValue()
  static readonly remember = (next: FeaturedDay): boolean => featured.set(next)
  static readonly useDismissed = (): readonly string[] => dismissed.useValue()
  static readonly dismiss = (rule: string): boolean => dismissed.set([...new Set([...dismissed.get(), rule])])
  static readonly restoreDismissed = (): void => dismissed.remove()
}
