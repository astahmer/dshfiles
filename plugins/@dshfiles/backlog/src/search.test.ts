import { describe, expect, it } from 'vitest'

import type { BacklogItem } from './item.js'
import { BacklogSearch } from './search.js'

const DAY_MS = 86_400_000

const item = (id: number, title: string, fields: Partial<BacklogItem> = {}): BacklogItem => ({
  id,
  title,
  body: '',
  kind: 'task',
  status: 'todo',
  project: '/work/welii',
  tags: [],
  links: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  humanFields: [],
  createdAt: 0,
  lastActivityAt: 0,
  events: [{ at: 0, actor: 'user', kind: 'created', detail: title }],
  ...fields,
})

const run = (query: string, items: readonly BacklogItem[], now = 0) =>
  items.flatMap(entry => {
    const match = BacklogSearch.score(entry, BacklogSearch.parse(query), now)
    return match === null ? [] : [{ id: entry.id, ...match }]
  })

describe('search', () => {
  it('ranks a title hit above a comment hit and says where each matched', () => {
    const results = run('paste', [
      item(1, 'Refactor the composer', {
        events: [{ at: 0, actor: 'agent:session-a', kind: 'commented', detail: 'The paste handler drops chips when the clipboard holds HTML.' }],
      }),
      item(2, 'Paste loses chips'),
    ]).sort((left, right) => right.score - left.score)
    expect(results.map(result => [result.id, result.fields])).toEqual([
      [2, ['title', 'capture']],
      [1, ['comment']],
    ])
    expect(results[1]?.snippet).toBe('The paste handler drops chips when the clipboard holds HTML.')
  })

  it('combines operators with free text', () => {
    const items = [
      item(1, 'Merge stopped on 429', {
        kind: 'bug',
        status: 'doing',
        attention: 'blocked',
        tags: ['crm'],
        links: [{ type: 'thread', target: 'session-x' }],
        actors: [{ id: 'agent:session-x', role: 'owner' }],
      }),
      item(2, 'Merge stopped on 429 again', { kind: 'bug', status: 'todo', tags: ['crm'] }),
      item(3, 'Note about 429s', { kind: 'note', project: '/work/nixfiles' }),
    ]
    expect(run('429 is:blocked', items).map(result => result.id)).toEqual([1])
    expect(run('kind:bug #crm status:todo', items).map(result => result.id)).toEqual([2])
    expect(run('has:thread by:agent', items).map(result => result.id)).toEqual([1])
    expect(run('project:nix 429', items).map(result => result.id)).toEqual([3])
    expect(run('"stopped on 429 again"', items).map(result => result.id)).toEqual([2])
  })

  it('filters by recency and matches ids exactly', () => {
    const items = [item(12, 'fresh one', { lastActivityAt: 9 * DAY_MS }), item(1, 'old one', { lastActivityAt: 0 })]
    expect(run('updated:<7d', items, 10 * DAY_MS).map(result => result.id)).toEqual([12])
    expect(run('updated:>7d', items, 10 * DAY_MS).map(result => result.id)).toEqual([1])
    expect(run('b:12', items).map(result => [result.id, result.fields])).toEqual([[12, ['id']]])
    expect(run('b:1', items).map(result => result.id)).toEqual([1])
  })
})
