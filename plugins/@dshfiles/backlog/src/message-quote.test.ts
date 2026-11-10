import { describe, expect, it } from 'vitest'

import { BacklogItems } from './item.js'
import { MessageQuote } from './message-quote.js'

describe('quoting a reply into a capture', () => {
  it('titles the capture with the first line, quotes the reply and links the thread', () => {
    const text = MessageQuote.captureText({ text: '## Fix the flaky sync test\n\nIt retries twice.', sessionId: 'session-9f8e7d6c' })

    expect(text).toBe('Fix the flaky sync test\n\n> ## Fix the flaky sync test\n>\n> It retries twice.\n\nFrom session-9f8e7d6c')
    expect(BacklogItems.triage(text).links).toContainEqual({ type: 'thread', target: 'session-9f8e7d6c', provenance: 'extracted' })
  })

  it('shortens a long first line to a title', () => {
    const title = MessageQuote.captureText({ text: 'word '.repeat(40), sessionId: 'session-9f8e7d6c' }).split('\n')[0] ?? ''

    expect(title.length).toBeLessThanOrEqual(80)
    expect(title.endsWith('…')).toBe(true)
  })
})
