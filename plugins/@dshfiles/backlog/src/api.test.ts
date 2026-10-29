import { describe, expect, it } from 'vitest'

import { backlogApi, BacklogViews, type BacklogDetailInput, type BacklogSummaryInput } from './api.js'

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

describe('API input schemas', () => {
  it('preserves reply attachments when omitted and accepts explicit replacement lists', async () => {
    const schema = backlogApi.methods.editComment.input
    if (schema === undefined) throw new Error('Edit reply input schema is missing')
    const validate = (value: unknown) => schema['~standard'].validate(value)
    const replacement = {
      id: 'reply-image-1',
      kind: 'image',
      name: 'replacement.png',
      mediaType: 'image/png',
      bytes: 4,
      data: 'iVBORw==',
    }

    expect((await validate({ id: 1, commentId: 'reply-1', text: 'Edited reply' })).issues).toBeUndefined()
    expect((await validate({ id: 1, commentId: 'reply-1', text: 'Edited reply', files: [replacement] })).issues).toBeUndefined()
    expect((await validate({ id: 1, commentId: 'reply-1', text: 'Edited reply', files: [] })).issues).toBeUndefined()
    expect((await validate({ id: 1, commentId: 'reply-1', text: '', files: [] })).issues).toBeDefined()
  })
})

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
