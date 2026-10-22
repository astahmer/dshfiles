import assert from 'node:assert/strict'
import { test } from 'vitest'

import { BACKLOG_NOTICE_HOLD_MS } from './notice-policy.js'

test('successful thread-start notices stay visible long enough to notice', () => {
  assert.equal(BACKLOG_NOTICE_HOLD_MS.success, 15_000)
})
