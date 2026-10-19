/**
 * One vocabulary for the two delays the sidebar waits out: the grace period before a rebased thread
 * is settled, and the one before a settled thread is archived.
 */
export const THREAD_DELAYS = ['disabled', 'immediately', 'after-1-hour', 'after-1-day', 'after-1-week'] as const

export type ThreadDelay = (typeof THREAD_DELAYS)[number]

export const threadDelayMs = (delay: ThreadDelay): number => {
  if (delay === 'immediately') return 0
  if (delay === 'after-1-hour') return 60 * 60_000
  if (delay === 'after-1-day') return 24 * 60 * 60_000
  if (delay === 'after-1-week') return 7 * 24 * 60 * 60_000
  return Number.POSITIVE_INFINITY
}
