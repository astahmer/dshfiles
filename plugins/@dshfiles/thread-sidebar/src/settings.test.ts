import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { threadSidebarSettings } from './settings.js'

test('Host settings reject malformed notification categories', () => {
  const invalid = {
    ...DEFAULT_PREFERENCES,
    notificationCategories: {
      ...DEFAULT_PREFERENCES.notificationCategories,
      'approval-needed': {
        ...DEFAULT_PREFERENCES.notificationCategories['approval-needed'],
        delivery: 'email',
        sound: 'yes',
        soundPreset: 'loud',
        volume: 2,
        injected: true,
      },
    },
  }
  const validate = threadSidebarSettings.schema['~standard'].validate

  // Schemastery reports a rejected value as Standard Schema issues rather than throwing.
  assert.equal('issues' in validate(DEFAULT_PREFERENCES), false)
  assert.equal('issues' in validate(invalid), true)
})
