import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  clearExpiredThreadMutes,
  clearThreadMute,
  completedSessionIds,
  DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
  isThreadMuted,
  markThreadSeen,
  setThreadMute,
} from './thread-notifications.js'
test('running-to-idle creates attention; initial idle does not', () => {
  assert.deepEqual(
    completedSessionIds({ first: true, second: false }, [
      { id: 'first', running: false },
      { id: 'second', running: false },
    ]),
    ['first'],
  )
})
test('timed snooze expires, while permanent mute lasts until cleared', () => {
  const timed = setThreadMute(DEFAULT_THREAD_NOTIFICATION_PREFERENCES, 'timed', 100)
  const muted = setThreadMute(timed, 'forever', null)
  assert.equal(isThreadMuted(muted, 'timed', 99), true)
  assert.equal(isThreadMuted(muted, 'timed', 100), false)
  assert.equal(isThreadMuted(muted, 'forever', 1_000_000), true)
  assert.deepEqual(clearExpiredThreadMutes(muted, 100).mutedUntil, { forever: null })
  assert.deepEqual(clearThreadMute(muted, 'forever').mutedUntil, { timed: 100 })
})
test('opening a thread clears its needs-you marker and keeps mute settings', () => {
  const muted = setThreadMute({ ...DEFAULT_THREAD_NOTIFICATION_PREFERENCES, needsYouAt: { thread: 123 } }, 'thread', null)
  assert.deepEqual(markThreadSeen(muted, 'thread'), { ...muted, needsYouAt: {} })
})
