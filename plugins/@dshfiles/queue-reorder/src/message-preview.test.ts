import assert from 'node:assert/strict'
import { test } from 'vitest'
import { messagePreview } from './message-preview.js'

test('flattens text and named blocks while excluding attachments', () => {
  assert.equal(
    messagePreview(
      [
        { type: 'text', text: '  First\nline ' },
        { type: 'image' },
        { type: 'tool-call' },
        { type: 'file' },
        { type: 'text', text: 'second' },
      ],
      80,
    ),
    'First line [tool-call] second',
  )
})

test('clips by Unicode code point and appends one ellipsis', () => {
  assert.equal(messagePreview([{ type: 'text', text: 'A🦊B🦊C' }], 4), 'A🦊B🦊…')
  assert.equal(messagePreview([{ type: 'text', text: 'A🦊B🦊C' }], 5), 'A🦊B🦊C')
})
