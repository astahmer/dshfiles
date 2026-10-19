import { describe, expect, it } from 'vitest'
import type { BacklogItem } from './item.js'
import { BacklogItems } from './item.js'
import { BacklogModel } from './store.js'

const DAY_MS = 86_400_000

const memoryTable = () => {
  const rows = new Map<string, BacklogItem>()
  return {
    rows,
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key: string, value: BacklogItem) => {
      rows.set(key, value)
    },
    delete: async (key: string) => rows.delete(key),
    update: async (key: string, change: (current: BacklogItem) => BacklogItem) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing row')
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
}

const clock = (start: number) => {
  let time = start
  return { now: () => time, advance: (ms: number) => (time += ms) }
}

const user = { kind: 'user' } as const
const agent = { kind: 'agent', sessionId: 'session-abc123', cwd: '/work/dshfiles' } as const

describe('triage', () => {
  it('derives kind, title, body, tags and links from free text', () => {
    const triaged = BacklogItems.triage(
      'bug: composer drops chips on paste #composer\nSeen in session-9f8e7d6c after jj:kvyxrlmk, see b:12 and https://github.com/o/r/pull/4.',
    )
    expect(triaged.kind).toBe('bug')
    expect(triaged.title).toBe('composer drops chips on paste')
    expect(triaged.body).toBe('Seen in session-9f8e7d6c after jj:kvyxrlmk, see b:12 and https://github.com/o/r/pull/4.')
    expect(triaged.tags).toEqual(['composer'])
    expect(triaged.links).toEqual([
      { type: 'item', target: '12' },
      { type: 'revision', target: 'kvyxrlmk' },
      { type: 'thread', target: 'session-9f8e7d6c' },
      { type: 'url', target: 'https://github.com/o/r/pull/4' },
    ])
  })

  it('makes a trailing question mark a question and keeps unknown prefixes in the title', () => {
    expect(BacklogItems.triage('should settled threads keep their workspace?').kind).toBe('question')
    const unknown = BacklogItems.triage('Ops: rotate the token')
    expect(unknown.kind).toBe('task')
    expect(unknown.title).toBe('Ops: rotate the token')
  })
})

describe('freshness', () => {
  const base = { kind: 'note', status: 'inbox', pinned: false, lastActivityAt: 0 } as const

  it('lets notes sink after two weeks and tasks after a month, but never pinned items', () => {
    expect(BacklogItems.freshness(base, 13 * DAY_MS)).toBe('fresh')
    expect(BacklogItems.freshness(base, 14 * DAY_MS)).toBe('dormant')
    expect(BacklogItems.freshness({ ...base, kind: 'task' }, 20 * DAY_MS)).toBe('fresh')
    expect(BacklogItems.freshness({ ...base, kind: 'task' }, 30 * DAY_MS)).toBe('dormant')
    expect(BacklogItems.freshness({ ...base, pinned: true }, 400 * DAY_MS)).toBe('fresh')
  })

  it('flags idle in-progress work as stale instead of hiding it, and archives closed items after a week', () => {
    expect(BacklogItems.freshness({ ...base, status: 'doing' }, 60 * DAY_MS)).toBe('stale')
    expect(BacklogItems.freshness({ ...base, status: 'done' }, 6 * DAY_MS)).toBe('fresh')
    expect(BacklogItems.freshness({ ...base, status: 'dropped' }, 7 * DAY_MS)).toBe('archived')
  })
})

describe('store', () => {
  it('links an agent capture to its thread and project, and lists newest activity first', async () => {
    const time = clock(1_000)
    const items = memoryTable()
    const store = BacklogModel.createStore({ items, now: time.now })

    const first = await store.capture({ text: 'idea: a kanban for agents', actor: user })
    time.advance(10)
    const second = await store.capture({ text: 'wire jj signals', actor: agent })
    await store.flush()

    expect(second.item.id).toBe(2)
    expect(second.item.project).toBe('/work/dshfiles')
    expect(second.item.links).toEqual([{ type: 'thread', target: 'session-abc123' }])
    expect(second.item.actors).toEqual([{ id: 'agent:session-abc123', role: 'owner' }])
    expect(store.list({}).items.map(item => item.id)).toEqual([2, 1])

    time.advance(10)
    await store.comment({ id: first.item.id, text: 'started a prototype', actor: user })
    expect(store.list({}).items.map(item => item.id)).toEqual([1, 2])
    expect([...items.rows.keys()].sort()).toEqual(['1', '2'])
  })

  it('hides dormant items from the feed until something touches them', async () => {
    const time = clock(0)
    const store = BacklogModel.createStore({ items: memoryTable(), now: time.now })
    await store.capture({ text: 'note: old thought', actor: user })
    time.advance(15 * DAY_MS)

    expect(store.list({}).total).toBe(0)
    expect(store.list({ freshness: 'dormant' }).items.map(item => item.title)).toEqual(['old thought'])
    expect(store.list({ freshness: 'all', query: 'thought' }).total).toBe(1)

    await store.update({ id: 1, status: 'todo', actor: user })
    expect(store.list({}).items.map(item => item.freshness)).toEqual(['fresh'])
  })

  it('records who moved an item and which fields the user owns', async () => {
    const store = BacklogModel.createStore({ items: memoryTable(), now: () => 5 })
    await store.capture({ text: 'ship the board', actor: agent })

    const moved = await store.update({ id: 1, status: 'doing', actor: user })
    expect(moved.ok && moved.value.item.humanFields).toEqual(['status'])
    expect(moved.ok && moved.value.item.events.at(-1)).toEqual({ at: 5, actor: 'user', kind: 'moved', detail: 'inbox → doing' })

    const byAgent = await store.update({ id: 1, kind: 'bug', actor: agent })
    expect(byAgent.ok && byAgent.value.item.humanFields).toEqual(['status'])
    expect(await store.update({ id: 99, status: 'done', actor: user })).toEqual({ ok: false, reason: 'not-found' })
  })

  it('answers backlinks for items and for any linked target', async () => {
    const store = BacklogModel.createStore({ items: memoryTable(), now: () => 1 })
    await store.capture({ text: 'parent epic', actor: user })
    await store.capture({ text: 'child step, part of b:1', actor: user })
    await store.link({ id: 2, link: { type: 'branch', target: 'feat/backlog' }, actor: user })

    const parent = store.get(1)
    expect(parent.ok && parent.value.backlinks.map(item => item.id)).toEqual([2])
    expect(store.referencing({ type: 'branch', target: 'feat/backlog' }).map(item => item.id)).toEqual([2])

    await store.link({ id: 2, link: { type: 'item', target: '1' }, remove: true, actor: user })
    const unlinked = store.get(1)
    expect(unlinked.ok && unlinked.value.backlinks).toEqual([])
  })

  it('continues ids after a Host restart', async () => {
    const items = memoryTable()
    const first = BacklogModel.createStore({ items, now: () => 1 })
    await first.capture({ text: 'one', actor: user })
    await first.capture({ text: 'two', actor: user })
    await first.flush()

    const reopened = BacklogModel.createStore({ items, now: () => 2 })
    expect((await reopened.capture({ text: 'three', actor: user })).item.id).toBe(3)
  })
})

describe('triage proposals', () => {
  it('applies automatic triage without touching fields the user set by hand', async () => {
    const store = BacklogModel.createStore({ items: memoryTable(), now: () => 9 })
    await store.capture({ text: 'Kodiak rebases FIFO', actor: user })
    await store.update({ id: 1, status: 'doing', actor: user })

    const applied = await store.applyProposal({
      id: 1,
      proposal: { kind: 'note', status: 'todo', confidence: 0.9, reason: '', source: 'jev', at: 9 },
      actor: { kind: 'system' },
    })
    expect(applied.ok && applied.value.item.kind).toBe('note')
    expect(applied.ok && applied.value.item.status).toBe('doing')
    expect(applied.ok && applied.value.item.events.at(-1)).toEqual({ at: 9, actor: 'system', kind: 'triaged', detail: 'applied kind note' })
  })

  it('keeps a hesitant proposal until the user accepts it, then treats its values as theirs', async () => {
    const store = BacklogModel.createStore({ items: memoryTable(), now: () => 9 })
    await store.capture({ text: 'parent epic', actor: user })
    await store.capture({ text: 'paste drops chips', actor: user })
    await store.propose({ id: 2, proposal: { kind: 'bug', duplicateOf: 1, confidence: 0.5, reason: 'Broken.', source: 'model', at: 9 } })
    expect(store.list({}).items.find(entry => entry.id === 2)?.proposal?.kind).toBe('bug')

    const accepted = await store.applyProposal({ id: 2, actor: user })
    expect(accepted.ok && accepted.value.item.kind).toBe('bug')
    expect(accepted.ok && accepted.value.item.humanFields).toEqual(['kind'])
    expect(accepted.ok && accepted.value.item.links).toEqual([{ type: 'item', target: '1' }])
    expect(accepted.ok && accepted.value.item.proposal).toBeNull()
  })

  it('dismisses a proposal without changing the item', async () => {
    const store = BacklogModel.createStore({ items: memoryTable(), now: () => 9 })
    await store.capture({ text: 'an idea', actor: user })
    await store.propose({ id: 1, proposal: { kind: 'idea', confidence: 0.4, reason: '', source: 'jev', at: 9 } })
    const dismissed = await store.dismissProposal({ id: 1, actor: user })
    expect(dismissed.ok && dismissed.value.item.kind).toBe('task')
    expect(dismissed.ok && dismissed.value.item.proposal).toBeNull()
    expect(dismissed.ok && dismissed.value.item.events.at(-1)?.detail).toBe('dismissed kind idea')
  })
})
