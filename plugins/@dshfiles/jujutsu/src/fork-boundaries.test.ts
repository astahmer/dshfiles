import assert from 'node:assert/strict'
import { test } from 'vitest'
import { durableForkBoundaries } from './fork-boundaries.ts'

test('fork boundaries preserve durable event sequence numbers exactly', () => {
  const entries: Parameters<typeof durableForkBoundaries>[0] = [
    { type: 'event', event: { type: 'turn/start', seq: 7 } },
    { type: 'transient', event: { type: 'assistant/live-chunk', seq: 9 } },
    { type: 'event', event: { type: 'turn/end', seq: 12 } },
  ]

  assert.deepEqual(durableForkBoundaries(entries), [
    { seq: 7, eventType: 'turn/start' },
    { seq: 12, eventType: 'turn/end' },
  ])
})
