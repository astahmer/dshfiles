import { describe, expect, it, vi } from 'vitest'

// The native package pulls its icon set at import; only its relative-time helper is used here.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  relativeTime: (at: number, now: number) => {
    const minutes = Math.floor((now - at) / 60_000)
    if (minutes < 1) return { unit: 'now', n: 0 }
    if (minutes < 60) return { unit: 'minutes', n: minutes }
    if (minutes < 1440) return { unit: 'hours', n: Math.floor(minutes / 60) }
    return { unit: 'days', n: Math.floor(minutes / 1440) }
  },
}))

import { RevisionTime } from './revision-time.js'

describe('the time on a revision detail line', () => {
  const now = Date.parse('2026-11-16T15:30:00Z')

  it('is one relative time, not three absolute timestamps', () => {
    const created = '2026-11-16T15:08:59Z'
    expect(RevisionTime.lastChanged({ authorTime: created, committerTime: created }, created, now)).toEqual({ dateTime: created, text: 'Created 21 min ago' })
  })

  it('names the latest change when the revision was edited or rewritten later', () => {
    const revision = { authorTime: '2026-11-14T09:00:00Z', committerTime: '2026-11-16T12:30:00Z' }
    expect(RevisionTime.lastChanged(revision, '2026-11-16T11:00:00Z', now)).toEqual({ dateTime: '2026-11-16T12:30:00Z', text: 'Changed 3 h ago' })
    expect(RevisionTime.lastChanged({ authorTime: '2026-11-16T15:29:50Z' }, undefined, now).text).toBe('Created just now')
  })
})
