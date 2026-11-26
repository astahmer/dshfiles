/**
 * The Plugins page's HMR updates row summary: what a restart would apply, or, with nothing pending, what the row is for
 * (council round 17, D3), so the row never reads as a bare title among described rows.
 */
export const IDLE_SUMMARY = 'See which rebuilt plugins wait for a DSH restart.'

export const rowSummary = (ids: readonly string[]): string => {
  if (ids.length === 0) return IDLE_SUMMARY
  if (ids.length === 1) return `${ids[0] ?? 'A plugin'} applies after DSH restarts.`
  return `${String(ids.length)} plugins apply after DSH restarts.`
}
