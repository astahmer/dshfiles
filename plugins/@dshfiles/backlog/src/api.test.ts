import { describe, expect, it } from 'vitest'

import { BacklogViews, type BacklogDetailInput, type BacklogSummaryInput } from './api.js'

const legacySummary = {
  id: 1,
  title: 'backlog crash when i clicked open',
  kind: 'bug',
  status: 'doing',
  project: null,
  tags: [],
  links: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  freshness: 'fresh',
  createdAt: 1,
  lastActivityAt: 2,
  preview: '',
  proposal: null,
  attention: 'none',
  acknowledgedAt: null,
  snoozedUntil: null,
  activity: { count: 0, agents: 0, comments: 0, last: null },
  match: null,
} satisfies BacklogSummaryInput

const legacyItem = {
  id: 1,
  title: 'backlog crash when i clicked open',
  body: '',
  kind: 'bug',
  status: 'doing',
  project: null,
  tags: [],
  links: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  humanFields: [],
  createdAt: 1,
  lastActivityAt: 2,
  events: [{ at: 1, actor: 'user', kind: 'created', detail: 'backlog crash when i clicked open' }],
} satisfies Omit<BacklogDetailInput['item'], 'freshness'>

describe('client decode', () => {
  it('fills the attachment list a Host that predates attachments omits', () => {
    const decoded = BacklogViews.list({ revision: 1, total: 1, items: [legacySummary] })
    expect(decoded.items[0]?.attachments).toEqual([])
  })

  it('fills attachments on both the item and its backlinks', () => {
    const decoded = BacklogViews.detail({ item: { ...legacyItem, freshness: 'fresh' }, backlinks: [legacySummary] })
    expect(decoded.item.attachments).toEqual([])
    expect(decoded.backlinks[0]?.attachments).toEqual([])
  })
})
