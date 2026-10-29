import assert from 'node:assert/strict'
import { test } from 'vitest'
import { MessagePreviewModel } from './message-preview.js'
import type { QueuedBlock } from './queue-edit.js'

test('preserves complete text blocks for rich reference rendering', () => {
  const reference = 'b:412 "queue refs rendering" (backlog item; backlog_get has its details)'
  assert.equal(MessagePreviewModel.messageText([{ type: 'text', text: `Review ${reference}` }, { type: 'image' }]), `Review ${reference}`)
})

test('flattens text and named blocks while excluding attachments', () => {
  assert.equal(
    MessagePreviewModel.messagePreview(
      [{ type: 'text', text: '  First\nline ' }, { type: 'image' }, { type: 'tool-call' }, { type: 'file' }, { type: 'text', text: 'second' }],
      80,
    ),
    'First line [tool-call] second',
  )
})

test('clips by Unicode code point and appends one ellipsis', () => {
  assert.equal(MessagePreviewModel.messagePreview([{ type: 'text', text: 'A🦊B🦊C' }], 4), 'A🦊B🦊…')
  assert.equal(MessagePreviewModel.messagePreview([{ type: 'text', text: 'A🦊B🦊C' }], 5), 'A🦊B🦊C')
})

test('previews each image and file in message order and skips text', () => {
  const blocks: readonly QueuedBlock[] = [
    { type: 'text', text: 'look' },
    { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png', name: 'shot.png' } },
    { type: 'file', attachment: { attachmentId: 'file-1', name: 'notes.md', bytes: 12 } },
    { type: 'image', attachment: { attachmentId: 'img-1', mediaType: 'image/png' } },
  ]
  assert.deepEqual(
    MessagePreviewModel.attachmentPreviews(blocks).map(preview => [preview.kind, preview.name, preview.key]),
    [
      ['image', 'shot.png', '1:img-1'],
      ['file', 'notes.md', '2:file-1'],
      ['image', 'image', '3:img-1'],
    ],
  )
  assert.deepEqual(MessagePreviewModel.attachmentPreviews([{ type: 'text', text: 'only text' }]), [])
})
