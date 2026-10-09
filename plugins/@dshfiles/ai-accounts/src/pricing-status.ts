import type { RelativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PricingStatus } from './api.js'

const AGO_SUFFIX = { minutes: 'min', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

/** "fetched 3h ago" from the Host's `relativeTime` bucket, so the catalog age reads like every other DSH surface. */
export const fetchedAgo = (age: RelativeTime): string => (age.unit === 'now' ? 'fetched just now' : `fetched ${String(age.n)}${AGO_SUFFIX[age.unit]} ago`)

const sourceName = (source: string): string => (URL.canParse(source) ? new URL(source).host : source)

/** The Settings hint under "Price catalog"; a `null` status is a Host that predates cost estimates. */
export const pricingStatusLine = (input: { readonly pricing: PricingStatus | null; readonly fetchedAge: RelativeTime | null }): string => {
  const pricing = input.pricing
  if (pricing === null) return 'This Host predates cost estimates; restart DSH to load them.'
  if (pricing.fetchedAt === null || input.fetchedAge === null) return pricing.lastError ?? 'No catalog yet.'
  const failure = pricing.lastError === null ? '' : ` · last refresh failed: ${pricing.lastError}`
  return `${String(pricing.modelCount)} models priced from ${sourceName(pricing.source)}, ${fetchedAgo(input.fetchedAge)}${failure}`
}
