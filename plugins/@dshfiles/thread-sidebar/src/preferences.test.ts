import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { parseStoredPreferences } from './preferences.js'

test('older stored preferences default the header and thread split to natural height', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: undefined })
  assert.ok(stored)
  assert.equal(parseStoredPreferences(stored).headerRegionHeight, null)
})

test('valid saved split heights persist and invalid heights fall back to defaults', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: 384 })
  const invalidStored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: 24 })

  assert.equal(parseStoredPreferences(stored).headerRegionHeight, 384)
  assert.equal(parseStoredPreferences(invalidStored).headerRegionHeight, DEFAULT_PREFERENCES.headerRegionHeight)
})
