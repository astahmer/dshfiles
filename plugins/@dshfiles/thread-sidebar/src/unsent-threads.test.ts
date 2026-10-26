import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { isListedUnsentThread, presentUnsentThread } from './unsent-threads.js'

const session = (id: string, blank = true): SessionSummary => ({
  id: SessionId(id),
  blank,
  displayTitle: 'project folder',
  running: false,
  retainedBy: {},
  updatedAt: 1,
})

describe('unsent thread rows', () => {
  it('shows the selected blank chat but not abandoned empty chats', () => {
    expect(isListedUnsentThread({ session: session('new'), selectedSessionId: 'new', draft: undefined })).toBe(true)
    expect(isListedUnsentThread({ session: session('abandoned'), selectedSessionId: 'new', draft: { preview: '' } })).toBe(false)
    expect(isListedUnsentThread({ session: session('spaces'), selectedSessionId: undefined, draft: { preview: '   ' } })).toBe(false)
  })

  it('lists multiple typed drafts without requiring a send or selection', () => {
    for (const id of ['first', 'second']) {
      expect(isListedUnsentThread({ session: session(id), selectedSessionId: 'third', draft: { preview: id } })).toBe(true)
    }
    expect(isListedUnsentThread({ session: session('sent', false), selectedSessionId: undefined, draft: undefined })).toBe(true)
  })

  it('labels new and typed rows without changing blankness or durable titles', () => {
    const source = session('new')
    const labels = { newChatLabel: 'New chat', draftLabel: (preview: string) => `Draft: ${preview}` }
    expect(presentUnsentThread({ session: source, draft: undefined, ...labels })).toMatchObject({ displayTitle: 'New chat', blank: true })
    expect(presentUnsentThread({ session: source, draft: { preview: 'Fix this' }, ...labels })).toMatchObject({ displayTitle: 'Draft: Fix this', blank: true })
    expect(source.displayTitle).toBe('project folder')
    const sent = session('sent', false)
    expect(presentUnsentThread({ session: sent, draft: { preview: 'follow-up' }, ...labels })).toBe(sent)
  })
})
