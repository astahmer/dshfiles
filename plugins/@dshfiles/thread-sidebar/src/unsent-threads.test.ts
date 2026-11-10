import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { isListedUnsentThread, presentUnsentRows } from './unsent-threads.js'

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
    const sent = session('sent', false)
    const labels = { newChatLabel: 'New chat', draftLabel: (preview: string) => `Draft: ${preview}` }
    const byId = { [source.id]: source, [sent.id]: sent }
    const presented = new WeakMap<SessionSummary, SessionSummary>()
    expect(presentUnsentRows({ byId, drafts: {}, presented, ...labels })[source.id]).toMatchObject({ displayTitle: 'New chat', blank: true })
    const typed = presentUnsentRows({ byId, drafts: { new: { preview: 'Fix this' } }, presented, ...labels })
    expect(typed[source.id]).toMatchObject({ displayTitle: 'Draft: Fix this', blank: true })
    expect(source.displayTitle).toBe('project folder')
    expect(typed[sent.id]).toBe(sent)
  })

  it('keeps the record and every presented row when a publish changed nothing they show', () => {
    const sent = session('sent', false)
    const labels = { newChatLabel: 'New chat', draftLabel: (preview: string) => `Draft: ${preview}` }
    const presented = new WeakMap<SessionSummary, SessionSummary>()
    const withoutBlank = { [sent.id]: sent }
    expect(presentUnsentRows({ byId: withoutBlank, drafts: {}, presented, ...labels })).toBe(withoutBlank)
    const blank = session('new')
    const first = presentUnsentRows({ byId: { [sent.id]: sent, [blank.id]: blank }, drafts: {}, presented, ...labels })
    const second = presentUnsentRows({ byId: { [sent.id]: { ...sent, running: true }, [blank.id]: blank }, drafts: {}, presented, ...labels })
    expect(second[blank.id]).toBe(first[blank.id])
  })
})
