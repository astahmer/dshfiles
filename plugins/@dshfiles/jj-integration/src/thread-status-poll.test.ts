import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { threadStatusPollMs } from './thread-status-poll.js'

describe('thread status poll', () => {
  it('stops without a workspace and polls fast only while an integration is queued', () => {
    assert.equal(threadStatusPollMs({ hasThread: false, queued: false }), false)
    assert.equal(threadStatusPollMs({ hasThread: true, queued: true }), 2_000)
    assert.equal(threadStatusPollMs({ hasThread: true, queued: false }), 60_000)
  })

  it('polls fast while the workspace menu is open, so a rebase done outside DSH shows without reloading', () => {
    assert.equal(threadStatusPollMs({ hasThread: true, queued: false, menuOpen: true }), 3_000)
    assert.equal(threadStatusPollMs({ hasThread: true, queued: false, menuOpen: false }), 60_000)
    assert.equal(threadStatusPollMs({ hasThread: true, queued: true, menuOpen: true }), 2_000)
    assert.equal(threadStatusPollMs({ hasThread: false, queued: false, menuOpen: true }), false)
  })
})
