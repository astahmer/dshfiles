const RELATIVE_UNITS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
]

/** A release date as "3 days ago" plus the full local date for hover; null when GitHub sent none or an invalid one. */
export const releaseDate = (input: { readonly publishedAt: string | null | undefined; readonly now: number; readonly locale: string }) => {
  if (input.publishedAt === null || input.publishedAt === undefined) return null
  const at = Date.parse(input.publishedAt)
  if (Number.isNaN(at)) return null
  const elapsed = at - input.now
  const bucket = RELATIVE_UNITS.find(([, unitSize]) => Math.abs(elapsed) >= unitSize)
  const relative = new Intl.RelativeTimeFormat(input.locale, { numeric: 'auto' })
  return {
    dateTime: new Date(at).toISOString(),
    relative: bucket === undefined ? relative.format(0, 'second') : relative.format(Math.round(elapsed / bucket[1]), bucket[0]),
    absolute: new Intl.DateTimeFormat(input.locale, { dateStyle: 'long', timeStyle: 'short' }).format(at),
  }
}
