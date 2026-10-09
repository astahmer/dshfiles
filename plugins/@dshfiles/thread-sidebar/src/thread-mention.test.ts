import assert from 'node:assert/strict'
import { test } from 'vitest'
import { decodeThreadMentionText, threadMentionText } from './thread-mention.js'

test('thread mentions are inserted as a token followed by one space', () => {
  assert.equal(threadMentionText('thr_123'), '@thread:thr_123 ')
})

test('thread mention events accept only non-empty text tokens', () => {
  assert.equal(decodeThreadMentionText(threadMentionText('thr_123')), '@thread:thr_123 ')
  assert.equal(decodeThreadMentionText('@thread:   '), null)
  assert.equal(decodeThreadMentionText({ text: '@thread:thr_123' }), null)
})
