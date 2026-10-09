import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { decodePreferences, preferencesToMigrate } from './preferences.js'

test('older stored preferences default the header and thread split to natural height', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: undefined })
  assert.ok(stored)
  assert.equal(decodePreferences(JSON.parse(stored))?.headerRegionHeight, null)
})

test('valid saved split heights persist and invalid heights are rejected', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: 384 })
  const invalidStored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: 24 })

  assert.equal(decodePreferences(JSON.parse(stored))?.headerRegionHeight, 384)
  assert.equal(decodePreferences(JSON.parse(invalidStored)), null)
})

test('preferences saved before navigation and palette settings existed gain their defaults', () => {
  const { navigationDensity, navigationOverflow, paletteChord, threadSearchChord, paletteRecentLimit, ...older } = DEFAULT_PREFERENCES
  const parsed = decodePreferences({ ...older, headerMode: 'expanded' })
  assert.ok(parsed)
  assert.equal(parsed.headerMode, 'expanded')
  assert.deepEqual(
    [parsed.navigationDensity, parsed.navigationOverflow, parsed.paletteChord, parsed.threadSearchChord, parsed.paletteRecentLimit],
    [navigationDensity, navigationOverflow, paletteChord, threadSearchChord, paletteRecentLimit],
  )
})

test('a disabled chord persists as null', () => {
  assert.equal(decodePreferences(JSON.parse(JSON.stringify({ ...DEFAULT_PREFERENCES, paletteChord: null })))?.paletteChord, null)
})

test('migration copies browser values only into Host keys still at their default', () => {
  const local = { ...DEFAULT_PREFERENCES, headerMode: 'expanded' as const, idleMinutes: 300, footerOrder: ['settings'] }
  const host = { ...DEFAULT_PREFERENCES, idleMinutes: 60 }
  assert.deepEqual(preferencesToMigrate(local, host), { headerMode: 'expanded', footerOrder: ['settings'] })
  assert.deepEqual(preferencesToMigrate(DEFAULT_PREFERENCES, host), {})
})

test('Host settings values decode through the sidebar contract', () => {
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, headerMode: 'diagonal' }), null)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, headerRegionHeight: 200 })?.headerRegionHeight, 200)
})
