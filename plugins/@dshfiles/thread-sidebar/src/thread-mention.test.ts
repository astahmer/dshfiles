import assert from 'node:assert/strict'
import { test } from 'vitest'
import { buildThreadReferenceInsert, decodeThreadMentionSessionId } from './thread-mention.js'

test('thread reference keeps the native session mention and title presentation', () => {
  const mention = '@[Explore Agent Questions Plugin Features](dsh-session:InNlc3Npb24tZXhhbXBsZSI)'

  assert.deepEqual(
    buildThreadReferenceInsert({
      mention,
      label: 'session-example',
      displayTitle: 'Explore Agent Questions Plugin Features',
    }),
    {
      source: 'reference',
      ref: mention,
      label: 'Explore Agent Questions Plugin Features',
      appearance: 'session',
      clipboardText: mention,
    },
  )
})

test('thread mention requests decode only a non-empty session id', () => {
  assert.equal(decodeThreadMentionSessionId({ sessionId: 'session-example' }), 'session-example')
  assert.equal(decodeThreadMentionSessionId({ sessionId: '' }), null)
  assert.equal(decodeThreadMentionSessionId({ sessionId: 'session-example', label: 'untrusted' }), null)
  assert.equal(decodeThreadMentionSessionId({ sessionId: 'x'.repeat(513) }), null)
  assert.equal(decodeThreadMentionSessionId('@thread:session-example'), null)
})
