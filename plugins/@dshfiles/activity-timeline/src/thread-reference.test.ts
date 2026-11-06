import { describe, expect, it } from 'vitest'
import { ThreadReferences } from './thread-reference.js'

const threadId = 'session-fa7fc099-47d3-4922-b603-986f90853c19'

describe('ThreadReferences', () => {
  it('reads the thread out of the URL a backlog activity line carries', () => {
    expect(ThreadReferences.threadIdIn(`error selecting model: ${`http://127.0.0.1:3080/?thread=${threadId}`}`)).toBe(threadId)
    expect(ThreadReferences.threadIdIn('see ?thread=session-6ef1d2ad-afcd-4274-a827-86876a8d35af&tab=1')).toBe('session-6ef1d2ad-afcd-4274-a827-86876a8d35af')
  })

  it('reads a bare id, the form older Host data stores', () => {
    expect(ThreadReferences.threadIdIn('the thread 5e34e9e2-12d5-4db0-9323-405d9aa9089d failed')).toBe('5e34e9e2-12d5-4db0-9323-405d9aa9089d')
  })

  it('answers null when the text names no thread, and ignores malformed ids', () => {
    expect(ThreadReferences.threadIdIn('b:86 needs your input.')).toBeNull()
    expect(ThreadReferences.threadIdIn('thread=not-a-session-id')).toBeNull()
    expect(ThreadReferences.threadIdIn('')).toBeNull()
  })

  it('prefers the item subject, then its reason, then its detail', () => {
    const subject = { kind: 'session', id: threadId }
    expect(ThreadReferences.threadIdOf({ subject, reason: 'Turn failed.', detail: null })).toBe(threadId)
    expect(
      ThreadReferences.threadIdOf({
        subject: { kind: 'backlog-item', id: '474' },
        reason: `b:474 ${`http://127.0.0.1:3080/?thread=${threadId}`} is blocked.`,
        detail: 'attention: blocked',
      }),
    ).toBe(threadId)
    expect(ThreadReferences.threadIdOf({ subject: { kind: 'backlog-item', id: '86' }, reason: 'b:86 needs input.', detail: `thread ${threadId} said` })).toBe(
      threadId,
    )
    expect(ThreadReferences.threadIdOf({ subject: { kind: 'backlog-item', id: '86' }, reason: 'b:86 needs input.', detail: null })).toBeNull()
  })
})
