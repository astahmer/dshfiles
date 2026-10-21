import { describe, expect, it } from 'vitest'
import type { BacklogItem } from './item.js'
import { BacklogItems } from './item.js'
import { BacklogModel, type BacklogFileRecord } from './store.js'

const DAY_MS = 86_400_000

const memoryTable = <Value>() => {
  const rows = new Map<string, Value>()
  return {
    rows,
    get: (key: string) => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key: string, value: Value) => {
      rows.set(key, value)
    },
    delete: async (key: string) => rows.delete(key),
    update: async (key: string, change: (current: Value) => Value) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing row')
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
}

const memoryFiles = () => memoryTable<BacklogFileRecord>()

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
      { type: 'item', target: '12', provenance: 'extracted' },
      { type: 'revision', target: 'kvyxrlmk', provenance: 'extracted' },
      { type: 'thread', target: 'session-9f8e7d6c', provenance: 'extracted' },
      { type: 'url', target: 'https://github.com/o/r/pull/4', provenance: 'extracted' },
    ])
  })

  it('keeps a secret reference as a link, never as a value', () => {
    const triaged = BacklogItems.triage('deploy key for the crawler is secret:CRAWLER_KEY@dev')
    expect(triaged.links).toEqual([{ type: 'secret', target: 'CRAWLER_KEY@dev', provenance: 'extracted' }])
    expect(triaged.links.some(link => link.target.startsWith('secret:'))).toBe(false)
  })

  it('makes a trailing question mark a question and keeps unknown prefixes in the title', () => {
    expect(BacklogItems.triage('should settled threads keep their workspace?').kind).toBe('question')
    const unknown = BacklogItems.triage('Ops: rotate the token')
    expect(unknown.kind).toBe('task')
    expect(unknown.title).toBe('Ops: rotate the token')
  })
})

describe('project paths', () => {
  it('folds a jj workspace to the project it was cut from and leaves a project path alone', () => {
    expect(BacklogItems.projectOf('/work/dshfiles-threads/thread-1b7a8c')).toBe('/work/dshfiles')
    expect(BacklogItems.projectOf('/work/dshfiles-threads/dshfiles-94a9c92d/')).toBe('/work/dshfiles')
    expect(BacklogItems.projectOf('/work/dshfiles')).toBe('/work/dshfiles')
    expect(BacklogItems.projectOf('/work/-threads')).toBe('/work/-threads')
    expect(BacklogItems.projectOf(null)).toBeNull()
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
  it('files a capture made in a jj workspace under the project it was cut from', async () => {
    const time = clock(2_000)
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: time.now })

    const fromWorkspace = await store.capture({
      text: 'fix the revision graph',
      actor: { kind: 'agent', sessionId: 'session-1b7a8c', cwd: '/work/dshfiles-threads/thread-1b7a8c' },
    })
    const fromProject = await store.capture({ text: 'ship the board', actor: agent })
    await store.flush()

    expect(fromWorkspace.item.project).toBe('/work/dshfiles')
    expect(store.projects()).toEqual([expect.objectContaining({ project: '/work/dshfiles', counts: expect.objectContaining({ inbox: 2 }) })])
    expect(
      store
        .list({ project: '/work/dshfiles-threads/thread-1b7a8c' })
        .items.map(item => item.id)
        .sort(),
    ).toEqual([1, 2])
    expect(store.list({ project: '/work/dshfiles' }).total).toBe(2)
    expect(fromProject.item.project).toBe('/work/dshfiles')
  })

  it('links an agent capture to its thread and project, and lists newest activity first', async () => {
    const time = clock(1_000)
    const items = memoryTable<BacklogItem>()
    const store = BacklogModel.createStore({ files: memoryFiles(), items, now: time.now })

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
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: time.now })
    await store.capture({ text: 'note: old thought', actor: user })
    time.advance(15 * DAY_MS)

    expect(store.list({}).total).toBe(0)
    expect(store.list({ freshness: 'dormant' }).items.map(item => item.title)).toEqual(['old thought'])
    expect(store.list({ freshness: 'all', query: 'thought' }).total).toBe(1)

    await store.update({ id: 1, status: 'todo', actor: user })
    expect(store.list({}).items.map(item => item.freshness)).toEqual(['fresh'])
  })

  it('records who moved an item and which fields the user owns', async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 5 })
    await store.capture({ text: 'ship the board', actor: agent })

    const moved = await store.update({ id: 1, status: 'doing', actor: user })
    expect(moved.ok && moved.value.item.humanFields).toEqual(['status'])
    expect(moved.ok && moved.value.item.events.at(-1)).toEqual({ at: 5, actor: 'user', kind: 'moved', detail: 'inbox → doing' })

    const byAgent = await store.update({ id: 1, kind: 'bug', actor: agent })
    expect(byAgent.ok && byAgent.value.item.humanFields).toEqual(['status'])
    expect(await store.update({ id: 99, status: 'done', actor: user })).toEqual({ ok: false, reason: 'not-found' })
  })

  it('answers backlinks for items and for any linked target', async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 1 })
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

  it('reads several items in one call, in order, and reports unknown ids separately', async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 1 })
    await store.capture({ text: 'one', actor: user })
    await store.capture({ text: 'two', actor: user })

    const many = store.getMany([2, 99, 1, 2])
    expect(many.items.map(detail => detail.item.id)).toEqual([2, 1])
    expect(many.missing).toEqual([99])
  })

  it('continues ids after a Host restart', async () => {
    const items = memoryTable<BacklogItem>()
    const first = BacklogModel.createStore({ files: memoryFiles(), items, now: () => 1 })
    await first.capture({ text: 'one', actor: user })
    await first.capture({ text: 'two', actor: user })
    await first.flush()

    const reopened = BacklogModel.createStore({ files: memoryFiles(), items, now: () => 2 })
    expect((await reopened.capture({ text: 'three', actor: user })).item.id).toBe(3)
  })
})

describe('triage proposals', () => {
  it('applies automatic triage without touching fields the user set by hand', async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 9 })
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
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 9 })
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
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 9 })
    await store.capture({ text: 'an idea', actor: user })
    await store.propose({ id: 1, proposal: { kind: 'idea', confidence: 0.4, reason: '', source: 'jev', at: 9 } })
    const dismissed = await store.dismissProposal({ id: 1, actor: user })
    expect(dismissed.ok && dismissed.value.item.kind).toBe('task')
    expect(dismissed.ok && dismissed.value.item.proposal).toBeNull()
    expect(dismissed.ok && dismissed.value.item.events.at(-1)?.detail).toBe('dismissed kind idea')
  })
})

describe('lifecycle signals', () => {
  it('moves an item forward on a signal, records the link, and never moves it back', async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 9 })
    await store.capture({ text: 'ship the board', actor: user })

    const started = await store.applySignal({ id: 1, status: 'doing', link: { type: 'thread', target: 'session-abc123' }, reason: 'mentioned in a thread' })
    expect(started.ok && started.value.item.status).toBe('doing')
    expect(started.ok && started.value.item.events.at(-1)).toEqual({ at: 9, actor: 'system', kind: 'moved', detail: 'inbox → doing (mentioned in a thread)' })

    const closed = await store.applySignal({ id: 1, status: 'done', link: { type: 'revision', target: 'kvyxrlmkptyv' }, reason: 'closed by jj:kvyxrlmkptyv' })
    expect(closed.ok && closed.value.item.status).toBe('done')

    const late = await store.applySignal({ id: 1, status: 'doing', link: { type: 'thread', target: 'session-later99' }, reason: 'mentioned in a thread' })
    expect(late.ok && late.value.item.status).toBe('done')
    expect(late.ok && late.value.item.links.map(link => link.target)).toEqual(['session-abc123', 'kvyxrlmkptyv', 'session-later99'])
  })

  it('links but does not move an item whose status the user chose', async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 9 })
    await store.capture({ text: 'parked on purpose', actor: user })
    await store.update({ id: 1, status: 'todo', actor: user })
    const signalled = await store.applySignal({
      id: 1,
      status: 'done',
      link: { type: 'revision', target: 'ruwkyzntnvpp' },
      reason: 'closed by jj:ruwkyzntnvpp',
    })
    expect(signalled.ok && signalled.value.item.status).toBe('todo')
    expect(signalled.ok && signalled.value.item.links).toEqual([{ type: 'revision', target: 'ruwkyzntnvpp' }])
  })
})

describe('thread turn signals', () => {
  const workingItem = async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 9 })
    await store.capture({ text: 'rework the composer chips #composer', actor: user })
    await store.applySignal({ id: 1, status: 'doing', link: { type: 'thread', target: 'session-abc123' }, reason: 'mentioned in a thread' })
    return store
  }

  it('flags an open item when its thread stopped and clears only that flag when the thread finishes', async () => {
    const store = await workingItem()
    const flagged = await store.applyThreadAttention({ id: 1, attention: 'blocked', reason: 'the thread failed: RATE_LIMIT' })
    expect(flagged.ok && flagged.value.item.attention).toBe('blocked')
    expect(flagged.ok && flagged.value.item.events.at(-1)?.detail).toBe('attention: blocked (the thread failed: RATE_LIMIT)')
    expect(store.list({ inbox: true }).items.map(item => item.id)).toEqual([1])

    const cleared = await store.applyThreadAttention({ id: 1, attention: 'none', reason: 'the thread works again' })
    expect(cleared.ok && cleared.value.item.attention).toBe('none')
    expect(cleared.ok && cleared.value.item.events.at(-1)?.detail).toBe('attention: none (the thread works again)')
    expect(store.list({ inbox: true }).total).toBe(0)
  })

  it('leaves an attention the user set by hand, and a closed item, alone', async () => {
    const store = await workingItem()
    await store.update({ id: 1, attention: 'needs-input', actor: user })
    const flagged = await store.applyThreadAttention({ id: 1, attention: 'blocked', reason: 'the thread stopped on a block' })
    expect(flagged.ok && flagged.value.item.attention).toBe('needs-input')

    await store.update({ id: 1, attention: 'none', status: 'done', actor: user })
    const late = await store.applyThreadAttention({ id: 1, attention: 'blocked', reason: 'the thread stopped on a block' })
    expect(late.ok && late.value.item.attention).toBe('none')
    expect(late.ok && late.value.item.status).toBe('done')
  })

  it('keeps a block an agent flagged itself when a later turn finishes', async () => {
    const store = await workingItem()
    await store.update({ id: 1, attention: 'blocked', actor: agent })
    const cleared = await store.applyThreadAttention({ id: 1, attention: 'none', reason: 'the thread works again' })
    expect(cleared.ok && cleared.value.item.attention).toBe('blocked')
  })
})

describe('attention and inbox', () => {
  it('puts an item asking for input in the Inbox, keeps it visible, and keeps it there once acknowledged', async () => {
    const time = clock(0)
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: time.now })
    await store.capture({ text: 'note: deploy order', actor: user })
    await store.update({ id: 1, attention: 'needs-input', actor: agent })
    time.advance(60 * DAY_MS)

    expect(store.list({}).items.map(item => [item.id, item.freshness, item.attention])).toEqual([[1, 'fresh', 'needs-input']])
    await store.acknowledge({ ids: [1] })
    expect(store.list({ inbox: true }).items.map(item => item.acknowledgedAt)).toEqual([60 * DAY_MS])

    await store.update({ id: 1, attention: 'none', actor: user })
    expect(store.list({ inbox: true }).total).toBe(0)
  })

  it('hides a snoozed item until its time, then lets it resurface', async () => {
    const time = clock(0)
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: time.now })
    await store.capture({ text: 'look at this later', actor: user })
    await store.update({ id: 1, snoozedUntil: DAY_MS, actor: user })
    expect(store.list({}).total).toBe(0)
    time.advance(DAY_MS)
    expect(store.list({}).total).toBe(1)
  })

  it('summarizes many agent updates as one activity line', async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 3 })
    await store.capture({ text: 'migrate users table', actor: user })
    await store.comment({ id: 1, text: 'read the schema', actor: agent })
    await store.comment({ id: 1, text: 'wrote the migration', actor: agent })
    await store.update({ id: 1, status: 'doing', actor: agent })
    expect(store.list({}).items[0]?.activity).toEqual({
      count: 3,
      agents: 1,
      comments: 2,
      last: { at: 3, actor: 'agent:session-abc123', kind: 'moved', detail: 'inbox → doing' },
    })
  })

  it('stamps who made a link', async () => {
    const store = BacklogModel.createStore({ files: memoryFiles(), items: memoryTable<BacklogItem>(), now: () => 3 })
    await store.capture({ text: 'parent', actor: user })
    const linked = await store.link({ id: 1, link: { type: 'revision', target: 'kvyxrlmkptyv', relation: 'implements' }, actor: agent })
    expect(linked.ok && linked.value.item.links).toEqual([{ type: 'revision', target: 'kvyxrlmkptyv', relation: 'implements', provenance: 'agent' }])
  })
  it('keeps images and files with an item, reads them back, and removes them', async () => {
    const time = clock(1_000)
    const files = memoryFiles()
    const store = BacklogModel.createStore({ items: memoryTable<BacklogItem>(), files, now: time.now })
    const detail = await store.capture({
      text: 'bug: composer loses pasted screenshots',
      files: [
        { id: 'image-one-1234', kind: 'image', name: 'shot.png', mediaType: 'image/png', bytes: 3, data: 'aGk=' },
        { id: 'file-one-1234', kind: 'file', name: 'spec.pdf', mediaType: 'application/pdf', bytes: 4, data: 'JVBERg==' },
      ],
      actor: user,
    })
    await store.flush()

    expect(detail.item.attachments.map(attachment => attachment.name)).toEqual(['shot.png', 'spec.pdf'])
    expect(store.list({}).items[0]?.attachments).toHaveLength(2)
    expect(await store.readFile({ id: detail.item.id, attachmentId: 'image-one-1234' })).toEqual({
      ok: true,
      value: { dataUrl: 'data:image/png;base64,aGk=' },
    })
    expect(await store.readFile({ id: detail.item.id, attachmentId: 'file-one-1234' })).toEqual({
      ok: true,
      value: { dataUrl: 'data:application/pdf;base64,JVBERg==' },
    })

    const removed = await store.removeFile({ id: detail.item.id, attachmentId: 'image-one-1234', actor: user })
    expect(removed.ok && removed.value.item.attachments.map(attachment => attachment.name)).toEqual(['spec.pdf'])
    expect(files.rows.size).toBe(1)
    expect(await store.readFile({ id: detail.item.id, attachmentId: 'image-one-1234' })).toEqual({ ok: false, reason: 'not-found' })
  })

  it('takes the kind, status and project the composer set, and records them as the user owns them', async () => {
    const store = BacklogModel.createStore({ items: memoryTable<BacklogItem>(), files: memoryFiles(), now: () => 1 })
    const detail = await store.capture({ text: 'fix the composer', kind: 'bug', status: 'doing', project: '/work/dshfiles', actor: user })
    expect(detail.item.kind).toBe('bug')
    expect(detail.item.status).toBe('doing')
    expect(detail.item.project).toBe('/work/dshfiles')
    expect(detail.item.humanFields).toEqual(['kind', 'status', 'project'])
  })
})
