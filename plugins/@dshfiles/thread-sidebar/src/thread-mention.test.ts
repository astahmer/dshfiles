import assert from 'node:assert/strict'
import { test } from 'vitest'
import { insertTextAtSelection } from './thread-mention.js'

test('thread mention insertion replaces the selected text and leaves the caret after the token', () => {
  assert.deepEqual(insertTextAtSelection({ value: 'ask  about this next', selectionStart: 5, selectionEnd: 10 }, '@thread:thr_123 '), {
    value: 'ask  @thread:thr_123  this next',
    selectionStart: 21,
    selectionEnd: 21,
  })
})

test('thread mention insertion clamps a stale selection to the current draft', () => {
  assert.deepEqual(insertTextAtSelection({ value: 'draft', selectionStart: 99, selectionEnd: 120 }, '@thread:thr_123 '), {
    value: 'draft@thread:thr_123 ',
    selectionStart: 21,
    selectionEnd: 21,
  })
})
