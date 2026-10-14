import { z } from 'zod'

/**
 * A muted thread: no desktop alerts, no attention groups, labels or unread dots, and its activity time stays at
 * `activityAt` so new activity does not lift it to the top. `until` null mutes until the user unmutes.
 */
export interface ThreadMute {
  readonly until: number | null
  readonly activityAt: number
}

export type ThreadMutes = Readonly<Record<string, ThreadMute>>

export const threadMuteSchema = z.object({ until: z.number().int().nonnegative().nullable(), activityAt: z.number().nonnegative() }).strict()

export const threadMutesSchema = z.record(z.string().min(1).max(256), threadMuteSchema).refine(value => Object.keys(value).length <= 5000)

export const THREAD_MUTE_OPTIONS = ['1h', '8h', '24h', 'tomorrow', 'week', 'forever'] as const
export type ThreadMuteOption = (typeof THREAD_MUTE_OPTIONS)[number]

export const muteOptionLabelKeys = {
  '1h': 'threadSidebarMuteFor1Hour',
  '8h': 'threadSidebarMuteFor8Hours',
  '24h': 'threadSidebarMuteFor24Hours',
  tomorrow: 'threadSidebarMuteUntilTomorrow',
  week: 'threadSidebarMuteFor1Week',
  forever: 'threadSidebarMuteForever',
} as const satisfies Record<ThreadMuteOption, string>

const HOUR = 60 * 60_000
// Snoozing "until tomorrow" wakes at this local hour.
const TOMORROW_MORNING_HOUR = 9

export const muteUntil = (option: ThreadMuteOption, now: number): number | null => {
  if (option === 'forever') return null
  if (option === 'tomorrow') {
    const date = new Date(now)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, TOMORROW_MORNING_HOUR).getTime()
  }
  const hours = { '1h': 1, '8h': 8, '24h': 24, week: 7 * 24 }[option]
  return now + hours * HOUR
}

export const isMuteActive = (mute: ThreadMute | undefined, now: number): mute is ThreadMute => mute !== undefined && (mute.until === null || mute.until > now)

export const isSessionMuted = (mutes: ThreadMutes, sessionId: string, now: number): boolean => isMuteActive(mutes[sessionId], now)

/** The activity time the sidebar sorts and ages a thread by: frozen while it is muted. */
export const effectiveActivityAt = (mutes: ThreadMutes, session: { readonly id: string; readonly updatedAt: number }, now: number): number => {
  const mute = mutes[session.id]
  return isMuteActive(mute, now) ? Math.min(session.updatedAt, mute.activityAt) : session.updatedAt
}

export const muteSessions = (options: {
  readonly mutes: ThreadMutes
  readonly sessions: readonly { readonly id: string; readonly updatedAt: number }[]
  readonly until: number | null
}) => ({
  ...options.mutes,
  ...Object.fromEntries(
    options.sessions.map(session => [
      session.id,
      // Re-snoozing keeps the original anchor, so the thread stays where it was when first muted.
      { until: options.until, activityAt: options.mutes[session.id]?.activityAt ?? session.updatedAt },
    ]),
  ),
})

export const unmuteSessions = (mutes: ThreadMutes, sessionIds: readonly string[]): ThreadMutes =>
  Object.fromEntries(Object.entries(mutes).filter(([sessionId]) => !sessionIds.includes(sessionId)))

export const withoutExpiredMutes = (mutes: ThreadMutes, now: number): ThreadMutes =>
  Object.fromEntries(Object.entries(mutes).filter(([, mute]) => isMuteActive(mute, now)))

export const nextMuteExpiry = (mutes: ThreadMutes, now: number): number | null =>
  Object.values(mutes)
    .flatMap(mute => (mute.until !== null && mute.until > now ? [mute.until] : []))
    .sort((left, right) => left - right)[0] ?? null

export type MuteRemaining =
  | { readonly kind: 'forever' }
  | { readonly kind: 'minutes'; readonly minutes: number }
  | { readonly kind: 'hours'; readonly hours: number; readonly minutes: number }
  | { readonly kind: 'days'; readonly days: number; readonly hours: number }

/** Rounded up, so a snooze never reads as over while it still holds. */
export const muteRemaining = (mute: ThreadMute, now: number): MuteRemaining => {
  if (mute.until === null) return { kind: 'forever' }
  const totalMinutes = Math.max(1, Math.ceil((mute.until - now) / 60_000))
  if (totalMinutes < 60) return { kind: 'minutes', minutes: totalMinutes }
  const totalHours = Math.floor(totalMinutes / 60)
  if (totalHours < 24) return { kind: 'hours', hours: totalHours, minutes: totalMinutes % 60 }
  return { kind: 'days', days: Math.floor(totalHours / 24), hours: totalHours % 24 }
}

/** Browser-only mutes from before they moved to Host settings, to copy once; the anchor is the thread's activity now. */
export const legacyMutesToMigrate = (options: {
  readonly legacy: Readonly<Record<string, number | null>>
  readonly hostMutes: ThreadMutes
  readonly updatedAt: (sessionId: string) => number | undefined
  readonly now: number
}): ThreadMutes =>
  Object.fromEntries(
    Object.entries(options.legacy).flatMap(([sessionId, until]) => {
      if (options.hostMutes[sessionId] !== undefined || (until !== null && until <= options.now)) return []
      return [[sessionId, { until, activityAt: options.updatedAt(sessionId) ?? options.now }]]
    }),
  )
