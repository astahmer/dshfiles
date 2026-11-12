import { describe, expect, test } from 'vitest'
import { backlogApi } from './api.js'

const modelRender = (detail: ReturnType<typeof detailOf>): string => {
  const render = backlogApi.methods.get.tool?.render
  if (render === undefined) throw new Error('backlog_get has no model-facing render')
  return render({ ok: true, value: detail })
}

const summary = (input: { readonly id: number; readonly ref: string; readonly title: string }) => ({
  ...input,
  kind: 'task',
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
  priority: 'none',
  parent: null,
  owner: 'user',
  delegate: null,
  children: { total: 0, done: 0 },
  ready: true,
  blockedBy: [],
  lease: null,
  criteriaProgress: { total: 0, done: 0 },
  planApproval: null,
  due: null,
  overdue: false,
  recurrence: null,
  gates: [],
})

const commentEvent = (input: { readonly at: number; readonly detail: string; readonly commentId: string }) => ({
  ...input,
  actor: 'user',
  kind: 'commented',
})

const detailOf = (input: { readonly body: string; readonly events: readonly ReturnType<typeof commentEvent>[] }) => ({
  item: {
    id: 42,
    ref: 'k3f9',
    title: 'Composer drops chips',
    body: input.body,
    kind: 'bug',
    status: 'doing',
    project: '/work/dshfiles',
    tags: ['composer'],
    links: [{ type: 'thread', target: 'session-abcdef' }],
    attachments: [],
    actors: [{ id: 'user', role: 'owner' }],
    pinned: false,
    humanFields: [],
    createdAt: 1,
    lastActivityAt: 2,
    events: [...input.events],
    freshness: 'fresh',
    priority: 'high',
    criteria: [{ id: 'c1-accept', text: 'Chips stay after send', done: true }],
  },
  backlinks: [summary({ id: 43, ref: 'm4p2', title: 'Composer sends twice' })],
  parentItem: null,
  children: [],
  blockedBy: [],
  lease: null,
  guidance: 'Run pnpm fmt before describing.',
})

const body = `start-${'m'.repeat(1_990)}-end`
const comment = `comment-${'c'.repeat(1_500)}-tail`

describe('backlog_get model-facing render', () => {
  test('an item with a 2000-character body and comments comes back whole', () => {
    expect(body).toHaveLength(2_000)
    const text = modelRender(detailOf({ body, events: [commentEvent({ at: 5, detail: comment, commentId: 'comment-5' })] }))

    expect(text).toContain('b:k3f9 — Composer drops chips')
    expect(text).toContain(body)
    expect(text).toContain(comment)
    expect(text).toContain('thread session-abcdef')
    expect(text).toContain('b:m4p2 — Composer sends twice (task · todo)')
    expect(text).toContain('Run pnpm fmt before describing.')
  })

  test('keeps the newest events and names the ones it leaves out', () => {
    const events = Array.from({ length: 260 }, (_entry, index) =>
      commentEvent({ at: index + 1, detail: `comment ${String(index + 1)}`, commentId: `comment-${String(index + 1)}` }),
    )
    const text = modelRender(detailOf({ body: 'A short body', events }))

    expect(text).toContain('comment 260')
    expect(text).toContain('comment 61')
    expect(text).not.toContain('comment 60')
    expect(text).toContain('Events (260, newest 200 shown, oldest first):')
    expect(text).toContain('60 earlier events not shown here; backlog_get_many returns the full history.')
  })

  test('bounds a few huge events by their size, not only their count', () => {
    const events = [1, 2, 3].map(index =>
      commentEvent({ at: index, detail: `comment ${String(index)} ${'c'.repeat(15_000)}`, commentId: `comment-${String(index)}` }),
    )
    const text = modelRender(detailOf({ body: 'A short body', events }))

    expect(text).toContain('comment 3 ')
    expect(text).toContain('comment 2 ')
    expect(text).not.toContain('comment 1 ')
    expect(text).toContain('1 earlier event not shown here; backlog_get_many returns the full history.')
  })
})
