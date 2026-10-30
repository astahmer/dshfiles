import { describe, expect, test } from 'vitest'

import { threadMentionText } from './thread-mention-drop.js'

describe('thread mention drop', () => {
  test('serializes the thread identity with its readable title', () => {
    expect(threadMentionText({ sessionId: 'session-42', title: 'Fix composer' })).toBe('@[Fix composer](dsh-session:InNlc3Npb24tNDIi) ')
  })

  test('keeps malformed labels from breaking the reference syntax and falls back to the id', () => {
    expect(threadMentionText({ sessionId: 'session-42', title: ' ]\n ' })).toBe('@[session-42](dsh-session:InNlc3Npb24tNDIi) ')
  })
})
