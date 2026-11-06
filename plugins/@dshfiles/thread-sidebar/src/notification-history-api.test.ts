import { Schema } from 'effect'
import { describe, expect, test } from 'vitest'
import { notificationHistoryApi, notificationHistoryEntrySchema } from './notification-history-api.js'
import { THREAD_NOTIFICATION_CATEGORIES } from './thread-notifications.js'

describe('notification history API', () => {
  test('exposes one shared operation per UI verb, with explicit clear confirmation', () => {
    const methods = notificationHistoryApi.methods
    expect(Object.values(methods).map(method => method.tool?.name)).toEqual([
      'notification_history_list',
      'notification_history_set_read',
      'notification_history_set_dismissed',
      'notification_history_clear',
    ])
    expect(methods.list.tool?.readOnly).toBe(true)
    const clearInput = methods.clear.input
    if (clearInput === undefined) throw new Error('Clear must require an input schema.')
    expect(Schema.is(clearInput)({ ids: ['event'] })).toBe(false)
    expect(Schema.is(clearInput)({ ids: ['event'], confirm: false })).toBe(false)
    expect(Schema.is(clearInput)({ ids: ['event'], confirm: true })).toBe(true)
    expect(Schema.is(clearInput)({ ids: Array.from({ length: 501 }, () => 'event'), confirm: true })).toBe(false)
  })

  test('covers each notification category without storing conversation contents', () => {
    for (const category of THREAD_NOTIFICATION_CATEGORIES) {
      const entry = { id: 'event', sessionId: 'thread', at: 10, category, read: false, dismissed: false }
      expect(Schema.is(notificationHistoryEntrySchema)(entry)).toBe(true)
      expect(() => Schema.decodeUnknownSync(notificationHistoryEntrySchema, { onExcessProperty: 'error' })({ ...entry, summary: 'private prompt' })).toThrow()
    }
  })
})
