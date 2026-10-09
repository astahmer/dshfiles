import assert from 'node:assert/strict'
import { test } from 'vitest'
import { frecencyBoosts, recordUse, type FrecencyEntries } from './frecency.js'

const HOUR = 3_600_000
const NOW = 1_800_000_000_000

test('recording a use counts it and refreshes its time', () => {
  const once = recordUse([], 'command:a', NOW - HOUR)
  const twice = recordUse(once, 'command:a', NOW)
  assert.deepEqual(twice, [{ id: 'command:a', count: 2, lastUsedAt: NOW }])
})

test('recent use outweighs an old habit until the habit is much stronger', () => {
  const entries: FrecencyEntries = [
    { id: 'old', count: 3, lastUsedAt: NOW - 30 * 24 * HOUR },
    { id: 'recent', count: 1, lastUsedAt: NOW - HOUR },
    { id: 'habit', count: 20, lastUsedAt: NOW - 30 * 24 * HOUR },
  ]
  const boosts = frecencyBoosts(entries, NOW)
  assert.ok((boosts.get('recent') ?? 0) > (boosts.get('old') ?? 0))
  assert.ok((boosts.get('habit') ?? 0) > (boosts.get('recent') ?? 0))
  assert.ok((boosts.get('habit') ?? 0) <= 800)
})

test('storage stays bounded and drops the weakest entries', () => {
  let entries: FrecencyEntries = Array.from({ length: 200 }, (_, index) => ({ id: `strong-${index}`, count: 5, lastUsedAt: NOW }))
  entries = recordUse(entries, 'weak', NOW - 60 * 24 * HOUR)
  assert.equal(entries.length, 200)
  assert.equal(
    entries.some(entry => entry.id === 'weak'),
    false,
  )
  entries = recordUse(entries, 'strong-7', NOW)
  assert.equal(entries[0]?.id, 'strong-7')
})
