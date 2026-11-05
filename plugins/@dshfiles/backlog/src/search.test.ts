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
  attachments: [],
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

  it('tells who captured an item apart from who touched it', () => {
    const items = [
      item(1, 'Captured by me, worked on by an agent', {
        actors: [
          { id: 'user', role: 'owner' },
          { id: 'agent:session-a', role: 'contributor' },
        ],
      }),
      item(2, 'Captured by an agent', {
        actors: [{ id: 'agent:session-b', role: 'owner' }],
        events: [{ at: 0, actor: 'agent:session-b', kind: 'created', detail: 'Captured by an agent' }],
      }),
      item(3, 'Imported by the system', { actors: [{ id: 'system', role: 'owner' }] }),
      item(4, 'Owner entry lost', { actors: [], events: [{ at: 0, actor: 'agent:session-c', kind: 'created', detail: 'x' }] }),
    ]
    expect(run('by:agent', items).map(result => result.id)).toEqual([1, 2])
    expect(run('created:agent', items).map(result => result.id)).toEqual([2, 4])
    expect(run('created:me', items).map(result => result.id)).toEqual([1])
    expect(run('created:user', items).map(result => result.id)).toEqual([1])
    expect(run('created:system', items).map(result => result.id)).toEqual([3])
    expect(run('created:me created:system', items).map(result => result.id)).toEqual([1, 3])
  })

  it('negates every operator and plain words with a leading dash', () => {
    const items = [
      item(1, 'Agent bug in the composer', {
        kind: 'bug',
        tags: ['composer'],
        attention: 'blocked',
        actors: [{ id: 'agent:session-a', role: 'owner' }],
        links: [{ type: 'thread', target: 'session-a' }],
        lastActivityAt: 9 * DAY_MS,
      }),
      item(2, 'A note of mine', {
        kind: 'note',
        status: 'doing',
        project: '/work/nixfiles',
        actors: [
          { id: 'user', role: 'owner' },
          { id: 'agent:session-b', role: 'contributor' },
        ],
      }),
      item(3, 'A plain task', {}),
    ]
    const ids = (query: string) => run(query, items, 10 * DAY_MS).map(result => result.id)
    expect(ids('-by:agent')).toEqual([3])
    expect(ids('-created:agent')).toEqual([2, 3])
    expect(ids('-created:me')).toEqual([1])
    expect(ids('-kind:note')).toEqual([1, 3])
    expect(ids('-is:bug -is:doing')).toEqual([3])
    expect(ids('-is:blocked')).toEqual([2, 3])
    expect(ids('-status:todo')).toEqual([2])
    expect(ids('-#comp')).toEqual([2, 3])
    expect(ids('-project:nix')).toEqual([1, 3])
    expect(ids('-has:thread')).toEqual([2, 3])
    expect(ids('-updated:<7d')).toEqual([2, 3])
    expect(ids('-updated:>7d')).toEqual([1])
    expect(ids('-composer')).toEqual([2, 3])
    expect(ids('-"plain task"')).toEqual([1, 2])
    expect(ids('a -note')).toEqual([1, 3])
    expect(ids('-b:3')).toEqual([1, 2])
  })
})
