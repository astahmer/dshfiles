import assert from 'node:assert/strict'
import { test } from 'vitest'
import { editableQueueText } from './queue-edit.js'

test('editableQueueText preserves text-only content', () => {
  assert.equal(
    editableQueueText([
      { type: 'text', text: '  keep spacing\n' },
      { type: 'text', text: 'and lines' },
    ]),
    '  keep spacing\nand lines',
  )
})

test('editableQueueText rejects attachments and blank content', () => {
  assert.equal(editableQueueText([{ type: 'text', text: 'message' }, { type: 'image' }]), null)
  assert.equal(editableQueueText([{ type: 'text', text: '  \n' }]), null)
  assert.equal(editableQueueText([]), null)
})
