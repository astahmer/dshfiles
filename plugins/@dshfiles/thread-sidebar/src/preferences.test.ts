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

test('preferences saved before navigation and palette settings existed gain their defaults', () => {
  const { navigationDensity, navigationOverflow, paletteChord, threadSearchChord, paletteRecentLimit, ...older } = DEFAULT_PREFERENCES
  const parsed = parseStoredPreferences(JSON.stringify({ ...older, headerMode: 'expanded' }))
  assert.equal(parsed.headerMode, 'expanded')
  assert.deepEqual(
    [parsed.navigationDensity, parsed.navigationOverflow, parsed.paletteChord, parsed.threadSearchChord, parsed.paletteRecentLimit],
    [navigationDensity, navigationOverflow, paletteChord, threadSearchChord, paletteRecentLimit],
  )
})

test('a disabled chord persists as null', () => {
  assert.equal(parseStoredPreferences(JSON.stringify({ ...DEFAULT_PREFERENCES, paletteChord: null })).paletteChord, null)
})
