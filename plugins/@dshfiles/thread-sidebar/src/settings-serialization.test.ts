import Schema from '@deepseek-ai/schemastery'
import { expect, test } from 'vitest'
import { threadSidebarSettings } from './settings.js'

/**
 * Browsers receive this schema as `toJSON()` and rebuild it before they mark the
 * namespace ready (dsh-client-ui-settings ConfigForm). A closure inside it
 * (`Schema.transform`) threw there, so every device fell back to browser storage.
 */
test('the settings schema survives the Host-to-browser trip and validates its own value', () => {
  const schema = threadSidebarSettings.schema
  const value = schema({ settledSessionIds: ['session-a'], settledAt: { 'session-a': 1 } })
  const json = JSON.stringify(schema.toJSON())
  expect(json).not.toMatch(/"callback"|"function"/)
  // SAFETY: the envelope is this schema's own toJSON output, so the rebuilt node validates the same value type.
  const rebuilt = new Schema(JSON.parse(json) as never) as unknown as typeof schema
  expect(() => rebuilt(value)).not.toThrow()
  expect(rebuilt(value)).toMatchObject({ settledSessionIds: ['session-a'] })
})

test('notification categories keep their per-category defaults', () => {
  const value = threadSidebarSettings.schema({ notificationCategories: { failed: { delivery: 'system' } } } as never)
  expect(value.notificationCategories.failed).toEqual({ delivery: 'system', sound: false, soundPreset: 'low', volume: 0.5 })
  expect(value.notificationCategories['input-needed'].soundPreset).toBe('chime')
})
