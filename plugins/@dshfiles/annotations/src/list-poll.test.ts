import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { annotationsListPollMs } from './list-poll.js'

describe('annotations list poll', () => {
  it('polls fast only while the popover can show the rows', () => {
    assert.equal(annotationsListPollMs(true), 4_000)
    assert.equal(annotationsListPollMs(false), 60_000)
  })
})
