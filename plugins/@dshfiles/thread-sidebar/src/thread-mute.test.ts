import { expect, test } from 'vitest'
import {
  effectiveActivityAt,
  isSessionMuted,
  legacyMutesToMigrate,
  muteRemaining,
  muteSessions,
  muteUntil,
  nextMuteExpiry,
  unmuteSessions,
  withoutExpiredMutes,
} from './thread-mute.js'

const HOUR = 60 * 60_000

test('each mute option wakes at its own time, and forever never does', () => {
  const now = new Date(2026, 9, 14, 22, 30).getTime()
  expect(muteUntil('1h', now)).toBe(now + HOUR)
  expect(muteUntil('8h', now)).toBe(now + 8 * HOUR)
  expect(muteUntil('24h', now)).toBe(now + 24 * HOUR)
  expect(muteUntil('week', now)).toBe(now + 7 * 24 * HOUR)
  expect(muteUntil('forever', now)).toBeNull()
  expect(new Date(muteUntil('tomorrow', now) ?? 0)).toEqual(new Date(2026, 9, 15, 9))
})

test('until tomorrow morning means the next calendar day even just after midnight', () => {
  const justAfterMidnight = new Date(2026, 9, 14, 0, 15).getTime()
  expect(new Date(muteUntil('tomorrow', justAfterMidnight) ?? 0)).toEqual(new Date(2026, 9, 15, 9))
})

test('a snooze wakes on its own while a mute lasts until unmuted', () => {
  const mutes = { snoozed: { until: 100, activityAt: 1 }, muted: { until: null, activityAt: 1 } }
  expect(isSessionMuted(mutes, 'snoozed', 99)).toBe(true)
  expect(isSessionMuted(mutes, 'snoozed', 100)).toBe(false)
  expect(isSessionMuted(mutes, 'muted', Number.MAX_SAFE_INTEGER)).toBe(true)
  expect(nextMuteExpiry(mutes, 50)).toBe(100)
  expect(nextMuteExpiry(mutes, 100)).toBeNull()
  expect(withoutExpiredMutes(mutes, 100)).toEqual({ muted: { until: null, activityAt: 1 } })
  expect(unmuteSessions(mutes, ['muted'])).toEqual({ snoozed: { until: 100, activityAt: 1 } })
})

test('a muted thread keeps the activity time it had when muted, and gets it back on waking', () => {
  const mutes = muteSessions({ mutes: {}, sessions: [{ id: 'quiet', updatedAt: 1_000 }], until: 5_000 })
  expect(effectiveActivityAt(mutes, { id: 'quiet', updatedAt: 4_000 }, 4_500)).toBe(1_000)
  expect(effectiveActivityAt(mutes, { id: 'quiet', updatedAt: 4_000 }, 5_000)).toBe(4_000)
  expect(effectiveActivityAt(mutes, { id: 'other', updatedAt: 4_000 }, 4_500)).toBe(4_000)
})

test('snoozing again changes the wake time but keeps the first anchor', () => {
  const first = muteSessions({ mutes: {}, sessions: [{ id: 'quiet', updatedAt: 1_000 }], until: 5_000 })
  const again = muteSessions({ mutes: first, sessions: [{ id: 'quiet', updatedAt: 3_000 }], until: null })
  expect(again.quiet).toEqual({ until: null, activityAt: 1_000 })
})

test('the remaining time rounds up and reads in minutes, hours or days', () => {
  expect(muteRemaining({ until: null, activityAt: 0 }, 0)).toEqual({ kind: 'forever' })
  expect(muteRemaining({ until: 30_001, activityAt: 0 }, 0)).toEqual({ kind: 'minutes', minutes: 1 })
  expect(muteRemaining({ until: 3 * HOUR + 12 * 60_000, activityAt: 0 }, 0)).toEqual({ kind: 'hours', hours: 3, minutes: 12 })
  expect(muteRemaining({ until: 50 * HOUR, activityAt: 0 }, 0)).toEqual({ kind: 'days', days: 2, hours: 2 })
})

test('browser-only mutes migrate once, skipping expired ones and threads the Host already mutes', () => {
  const migrated = legacyMutesToMigrate({
    legacy: { forever: null, active: 500, expired: 50, known: null },
    hostMutes: { known: { until: 900, activityAt: 1 } },
    updatedAt: sessionId => (sessionId === 'active' ? 42 : undefined),
    now: 100,
  })
  expect(migrated).toEqual({ forever: { until: null, activityAt: 100 }, active: { until: 500, activityAt: 42 } })
})
