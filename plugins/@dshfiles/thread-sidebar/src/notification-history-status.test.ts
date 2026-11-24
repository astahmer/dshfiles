import { describe, expect, it } from 'vitest'
import { NotificationHistoryPresentation } from './notification-history-panel.js'
import type { NotificationHistoryEntry } from './notification-history-api.js'

const entry = (category: NotificationHistoryEntry['category'], read = false): Pick<NotificationHistoryEntry, 'category' | 'read'> => ({ category, read })

describe('notification history glyphs', () => {
  it('draws a stopped turn with the stopped glyph, never Ready', () => {
    expect(NotificationHistoryPresentation.statusOf(entry('stopped'))).toBe('stopped')
    expect(NotificationHistoryPresentation.statusOf(entry('turn-finished'))).toBe('ready')
    expect(NotificationHistoryPresentation.statusOf(entry('failed'))).toBe('failed')
    expect(NotificationHistoryPresentation.statusOf(entry('input-needed'))).toBe('needs-you')
    expect(NotificationHistoryPresentation.statusOf(entry('stopped', true))).toBe('idle')
  })
})
