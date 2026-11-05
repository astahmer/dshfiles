import { Result, Schema } from 'effect'
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
    const validate = (value: unknown) => Schema.decodeUnknownResult(schema)(value)
    const replacement = {
      id: 'reply-image-1',
      kind: 'image',
      name: 'replacement.png',
      mediaType: 'image/png',
      bytes: 4,
      data: 'iVBORw==',
    }

    expect(Result.isSuccess(validate({ id: 1, commentId: 'reply-1', text: 'Edited reply' }))).toBe(true)
    expect(Result.isSuccess(validate({ id: 1, commentId: 'reply-1', text: 'Edited reply', files: [replacement] }))).toBe(true)
    expect(Result.isSuccess(validate({ id: 1, commentId: 'reply-1', text: 'Edited reply', files: [] }))).toBe(true)
    expect(Result.isFailure(validate({ id: 1, commentId: 'reply-1', text: '', files: [] }))).toBe(true)
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

describe('list view', () => {
  it('reads a list from a Host without the agent-item filter as hiding none', () => {
    expect(BacklogViews.list({ revision: 1, total: 1, items: [legacySummary] }).hiddenAgentItems).toBe(0)
  })
})

describe('agent-item filter input', () => {
  it('adds hideAgentItems only when hiding, so an older Host never sees the key', () => {
    expect(BacklogViews.hidingAgentItems({ query: 'x' }, false)).toEqual({ query: 'x' })
    expect(BacklogViews.hidingAgentItems({ query: 'x' }, true)).toEqual({ query: 'x', hideAgentItems: true })
  })
})

describe('shipped input', () => {
  it('takes a unit period with an optional count, projects and time zone, or a custom range with both bounds in order', () => {
    const schema = backlogApi.methods.shipped.input
    if (schema === undefined) throw new Error('shipped takes an input')
    const decode = Schema.decodeUnknownResult(schema)
    expect(Result.isSuccess(decode({ period: 'day' }))).toBe(true)
    expect(Result.isSuccess(decode({ period: 'hour', count: 24, projects: ['/repo/app', null], tzOffsetMinutes: -120 }))).toBe(true)
    expect(Result.isSuccess(decode({ period: 'custom', from: 1, to: 2 }))).toBe(true)
    expect(Result.isSuccess(decode({ period: 'custom', from: 1 }))).toBe(false)
    expect(Result.isSuccess(decode({ period: 'custom', from: 2, to: 2 }))).toBe(false)
    expect(Result.isSuccess(decode({ period: 'decade' }))).toBe(false)
    expect(Result.isSuccess(decode({ period: 'week', count: 0 }))).toBe(false)
    expect(Result.isSuccess(decode({ period: 'week', count: 61 }))).toBe(false)
    expect(Result.isSuccess(decode({ period: 'day', tzOffsetMinutes: 900 }))).toBe(false)
  })

  it('decodes a digest from a Host without summaries as having none', () => {
    const bucket = { start: 0, end: 1, count: 0, previousCount: 0, projects: [] }
    expect(BacklogViews.shipped({ period: 'day', tzOffsetMinutes: 0, from: 0, to: 1, total: 0, buckets: [bucket] }).buckets[0]?.summary).toBeNull()
  })

  it('needs a summarize range in order', () => {
    const schema = backlogApi.methods.summarizeShipped.input
    if (schema === undefined) throw new Error('summarizeShipped takes an input')
    const decode = Schema.decodeUnknownResult(schema)
    expect(Result.isSuccess(decode({ period: 'week', start: 0, end: 10 }))).toBe(true)
    expect(Result.isSuccess(decode({ period: 'week', start: 10, end: 10 }))).toBe(false)
  })
})
