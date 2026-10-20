import { describe, expect, it } from 'vitest'

import type { BacklogSummaryView } from './api.js'
import { BacklogMentions } from './backlog-mentions.js'

const summary = (id: number, title: string): BacklogSummaryView => ({
  id,
  title,
  kind: 'bug',
  status: 'todo',
  project: null,
  tags: [],
  links: [],
  attachments: [],
  actors: [],
  pinned: false,
  freshness: 'fresh',
  createdAt: 1,
  lastActivityAt: 1,
  preview: '',
  proposal: null,
  attention: 'none',
  acknowledgedAt: null,
  snoozedUntil: null,
  activity: { count: 0, agents: 0, comments: 0, last: null },
  match: null,
})

const request = (query: string) => ({ query, quoted: false, signal: new AbortController().signal }) as const

describe('backlog @ mentions', () => {
  it('lists the backlog alone under @b:, a few items under plain @, nothing under another scope', async () => {
    const limits: number[] = []
    const source = BacklogMentions.createSource({
      section: 'Backlog',
      search: async (_query, limit) => {
        limits.push(limit)
        return [summary(12, 'Composer drops chips')]
      },
    })
    const session = { sessionId: 'session-abc123' } as never
    expect((await source.candidates(session, request('b:chips') as never)).map(candidate => candidate.name)).toEqual(['b:12'])
    expect(await source.candidates(session, request('chips') as never)).toHaveLength(1)
    expect(await source.candidates(session, request('') as never)).toEqual([])
    expect(await source.candidates(session, request('mcp:chips') as never)).toEqual([])
    expect(limits).toEqual([40, 5])
  })

  it('sends a chip as text naming b:<id>, so the thread signal sees it', async () => {
    const source = BacklogMentions.createSource({ section: 'Backlog', search: async () => [] })
    const picked = source.onPick({ candidate: { name: 'b:12', value: JSON.stringify({ id: 12, title: 'Composer drops chips' }) } } as never)
    expect(picked).toEqual({
      insert: {
        source: 'backlog',
        ref: '{"id":12,"title":"Composer drops chips"}',
        label: 'b:12 Composer drops chips',
        clipboardText: 'b:12 Composer drops chips',
      },
    })
    expect(await source.codec?.serialize('{"id":12,"title":"Composer drops chips"}', new AbortController().signal)).toBe(
      'b:12 "Composer drops chips" (backlog item; backlog_get has its details)',
    )
  })
})
