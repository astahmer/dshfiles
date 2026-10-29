import { encodeSessionReferenceUri } from '@deepseek-ai/dsh-session-reference'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { followUpPrompt } from './follow-up.js'

describe('followUpPrompt', () => {
  it('prefills a structured session reference with the source thread title', () => {
    const mention = `@[Source thread](${encodeSessionReferenceUri(SessionId('session-example'))})`
    expect(followUpPrompt('session-example', 'Source thread')).toEqual({
      text: `Follow-up after ${mention} :\n`,
      references: [
        {
          source: 'reference',
          ref: mention,
          offset: 'Follow-up after '.length,
          length: mention.length,
          label: 'Source thread',
          appearance: 'session',
          clipboardText: mention,
        },
      ],
    })
  })

  it('uses a safe fallback label when the title cannot form a mention', () => {
    expect(followUpPrompt('session-example', ']\n')).toMatchObject({
      references: [{ label: 'thread' }],
    })
  })

  it('rejects an empty source thread ID', () => {
    expect(() => followUpPrompt('')).toThrow('A follow-up requires a valid thread ID.')
  })
})
