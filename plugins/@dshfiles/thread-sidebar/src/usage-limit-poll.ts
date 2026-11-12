/**
 * The change event announces each stored, resumed or dismissed recovery, so the list polls only without that stream,
 * or while a recovery waits: its reset passing turns it ready on the clock, with no write to announce it.
 */
export const usageLimitRefetchInterval = (input: {
  readonly primarySurface: boolean
  readonly ownerMissing: boolean
  readonly errored: boolean
  readonly eventsLive: boolean
  readonly waiting: boolean
}): number | false => {
  if (!input.primarySurface || input.ownerMissing || input.errored) return false
  if (input.eventsLive && !input.waiting) return false
  return 15_000
}
