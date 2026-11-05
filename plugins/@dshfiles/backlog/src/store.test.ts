import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogRepo } from './backlog-repo.js'
import type { BacklogItem, BacklogLink } from './item.js'
import { BacklogItems } from './item.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const DAY_MS = 86_400_000

const openStore = (rows = backlogRows()) => Effect.map(Layer.build(backlogStoreLayer({ rows })), context => Context.get(context, BacklogStore))
const openRepo = (rows: ReturnType<typeof backlogRows>) => Effect.map(Layer.build(backlogStoreLayer({ rows })), context => Context.get(context, BacklogRepo))

/** An item the JSON storage domain held before the SQLite store. */
const legacyItem = (fields: Partial<BacklogItem> & Pick<BacklogItem, 'id'>): BacklogItem => ({
  title: 'legacy item',
  body: '',
  kind: 'task',
  status: 'inbox',
  project: null,
  tags: [],
  links: [],
  attachments: [],
  actors: [{ id: 'user', role: 'owner' }],
  pinned: false,
  humanFields: [],
  createdAt: 9,
  lastActivityAt: 9,
  events: [{ at: 9, actor: 'user', kind: 'created', detail: 'legacy item' }],
  ...fields,
})

const user = { kind: 'user' } as const
const agent = { kind: 'agent', sessionId: 'session-abc123', cwd: '/work/dshfiles' } as const

describe('relationship identity', () => {
  it('deduplicates identical targets even when their provenance differs', () => {
    const first: BacklogLink = { type: 'thread', target: 'session-abc123', provenance: 'user' }
    const duplicate: BacklogLink = { type: 'thread', target: 'session-abc123', provenance: 'agent' }
    const other: BacklogLink = { type: 'thread', target: 'session-def456', provenance: 'user' }

    expect(BacklogItems.uniqueLinks([first, duplicate, other])).toEqual([first, other])
  })
})

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

  it('preserves title characters beyond the title limit in the body', () => {
    const title = 'x'.repeat(BacklogItems.maxTitleChars + 1)
    const triaged = BacklogItems.triage(`${title}\n\nDetails`)

    expect(triaged.title).toBe(title.slice(0, BacklogItems.maxTitleChars))
    expect(triaged.body).toBe(`${title.slice(BacklogItems.maxTitleChars)}\n\nDetails`)
  })

  it('keeps a readable project mention as a workspace reference without assigning the project', () => {
    const triaged = BacklogItems.triage('Investigate [dshfiles](workspace:%2Fwork%2Fdshfiles)')
    expect(triaged.links).toEqual([{ type: 'workspace', target: '%2Fwork%2Fdshfiles', provenance: 'extracted' }])
    expect('project' in triaged).toBe(false)
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
    expect(BacklogItems.freshness({ ...base, status: 'done', attention: 'blocked' }, 8 * DAY_MS)).toBe('archived')
  })
})

describe('store', () => {
  it.effect('files a capture made in a jj workspace under the project it was cut from', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(2_000)
      const store = yield* openStore()

      const fromWorkspace = yield* store.capture({
        text: 'fix the revision graph',
        actor: { kind: 'agent', sessionId: 'session-1b7a8c', cwd: '/work/dshfiles-threads/thread-1b7a8c' },
      })
      const fromProject = yield* store.capture({ text: 'ship the board', actor: agent })

      expect(fromWorkspace.item.project).toBe('/work/dshfiles')
      expect(yield* store.projects).toEqual([expect.objectContaining({ project: '/work/dshfiles', counts: expect.objectContaining({ inbox: 2 }) })])
      expect((yield* store.list({ project: '/work/dshfiles-threads/thread-1b7a8c' })).items.map(item => item.id).sort()).toEqual([1, 2])
      expect((yield* store.list({ project: '/work/dshfiles' })).total).toBe(2)
      expect(fromProject.item.project).toBe('/work/dshfiles')
    }).pipe(Effect.scoped),
  )

  it.effect('filters by any of several projects, including items without a project', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1)
      const store = yield* openStore()
      yield* store.capture({ text: 'in dshfiles', project: '/work/dshfiles', actor: user })
      yield* store.capture({ text: 'in bb-plugins', project: '/work/bb-plugins', actor: user })
      yield* store.capture({ text: 'unassigned', actor: user })
      yield* store.capture({ text: 'in another project', project: '/work/other', actor: user })

      expect((yield* store.list({ projects: ['/work/dshfiles', '/work/bb-plugins', null] })).items.map(item => item.title)).toEqual([
        'unassigned',
        'in bb-plugins',
        'in dshfiles',
      ])
    }).pipe(Effect.scoped),
  )

  it.effect('links an agent capture to its thread and project, and lists newest activity first', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const rows = backlogRows()
      const store = yield* openStore(rows)

      const first = yield* store.capture({ text: 'idea: a kanban for agents', actor: user })
      yield* TestClock.adjust(10)
      const second = yield* store.capture({ text: 'wire jj signals', actor: agent })

      expect(second.item.id).toBe(2)
      expect(second.item.project).toBe('/work/dshfiles')
      expect(second.item.links).toEqual([{ type: 'thread', target: 'session-abc123' }])
      expect(second.item.actors).toEqual([{ id: 'agent:session-abc123', role: 'owner' }])
      expect((yield* store.list({})).items.map(item => item.id)).toEqual([2, 1])

      yield* TestClock.adjust(10)
      yield* store.comment({ id: first.item.id, text: 'started a prototype', actor: user })
      expect((yield* store.list({})).items.map(item => item.id)).toEqual([1, 2])
      expect((yield* (yield* openStore(rows)).list({})).items.map(item => item.id).sort()).toEqual([1, 2])
    }).pipe(Effect.scoped),
  )

  it.effect('hides dormant items from the feed until something touches them', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0)
      const store = yield* openStore()
      yield* store.capture({ text: 'note: old thought', actor: user })
      yield* TestClock.adjust(15 * DAY_MS)

      expect((yield* store.list({})).total).toBe(0)
      expect((yield* store.list({ freshness: 'dormant' })).items.map(item => item.title)).toEqual(['old thought'])
      expect((yield* store.list({ freshness: 'all', query: 'thought' })).total).toBe(1)

      yield* store.update({ id: 1, status: 'todo', actor: user })
      expect((yield* store.list({})).items.map(item => item.freshness)).toEqual(['fresh'])
    }).pipe(Effect.scoped),
  )

  it.effect('records who moved an item and which fields the user owns', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(5)
      const store = yield* openStore()
      yield* store.capture({ text: 'ship the board', actor: agent })

      const moved = yield* store.update({ id: 1, status: 'doing', actor: user })
      expect(moved.ok && moved.value.item.humanFields).toEqual(['status'])
      expect(moved.ok && moved.value.item.events.at(-1)).toEqual({
        at: 5,
        actor: 'user',
        origin: 'user',
        kind: 'moved',
        detail: 'inbox → doing',
        fieldChanges: [{ field: 'status', before: 'inbox', after: 'doing' }],
      })

      const byAgent = yield* store.update({ id: 1, kind: 'bug', actor: agent })
      expect(byAgent.ok && byAgent.value.item.humanFields).toEqual(['status'])
      expect(yield* store.update({ id: 99, status: 'done', actor: user })).toEqual({ ok: false, reason: 'not-found' })
    }).pipe(Effect.scoped),
  )

  it.effect('stores before and after values for edited fields', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(5)
      const store = yield* openStore()
      yield* store.capture({ text: 'old title', actor: user })

      const edited = yield* store.update({ id: 1, title: 'new title', actor: user })

      expect(edited.ok && edited.value.item.events.at(-1)?.fieldChanges).toEqual([{ field: 'title', before: 'old title', after: 'new title' }])
    }).pipe(Effect.scoped),
  )

  it.effect('answers backlinks for items and for any linked target', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1)
      const store = yield* openStore()
      const parentRef = (yield* store.capture({ text: 'parent epic', actor: user })).item.ref ?? ''
      yield* store.capture({ text: `child step, part of b:${parentRef}`, actor: user })
      yield* store.link({ id: 2, link: { type: 'branch', target: 'feat/backlog' }, actor: user })

      const parent = yield* store.get(1)
      expect(parent.ok && parent.value.backlinks.map(item => item.id)).toEqual([2])
      expect((yield* store.referencing({ type: 'branch', target: 'feat/backlog' })).map(item => item.id)).toEqual([2])

      yield* store.link({ id: 2, link: { type: 'item', target: parentRef }, remove: true, actor: user })
      const unlinked = yield* store.get(1)
      expect(unlinked.ok && unlinked.value.backlinks).toEqual([])
    }).pipe(Effect.scoped),
  )

  it.effect('reads several items in one call, in order, and reports unknown ids separately', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1)
      const store = yield* openStore()
      yield* store.capture({ text: 'one', actor: user })
      yield* store.capture({ text: 'two', actor: user })

      const many = yield* store.getMany([2, 99, 1, 2])
      expect(many.items.map(detail => detail.item.id)).toEqual([2, 1])
      expect(many.missing).toEqual([99])
    }).pipe(Effect.scoped),
  )

  it.effect('continues ids after a Host restart', () =>
    Effect.gen(function* () {
      const rows = backlogRows()
      yield* TestClock.setTime(1)
      const first = yield* openStore(rows)
      yield* first.capture({ text: 'one', actor: user })
      yield* first.capture({ text: 'two', actor: user })

      yield* TestClock.setTime(2)

      const reopened = yield* openStore(rows)
      expect((yield* reopened.capture({ text: 'three', actor: user })).item.id).toBe(3)
    }).pipe(Effect.scoped),
  )

  it.effect('never reuses the id of a deleted newest item after a Host restart', () =>
    Effect.gen(function* () {
      const rows = backlogRows()
      const first = yield* openStore(rows)
      yield* first.capture({ text: 'one', actor: user })
      const newest = yield* first.capture({ text: 'two', actor: user })
      yield* first.delete({ id: newest.item.id })

      const reopened = yield* openStore(rows)
      expect((yield* reopened.capture({ text: 'three', actor: user })).item.id).toBe(3)
    }).pipe(Effect.scoped),
  )

  it.effect('continues after the largest stored id when the counter lags behind it', () =>
    Effect.gen(function* () {
      const rows = backlogRows({ legacy: { items: [legacyItem({ id: 1 }), legacyItem({ id: 2 })], nextId: 2 } })

      const reopened = yield* openStore(rows)
      expect((yield* reopened.capture({ text: 'three', actor: user })).item.id).toBe(3)
    }).pipe(Effect.scoped),
  )
})

describe('triage proposals', () => {
  it.effect('applies automatic triage without touching fields the user set by hand', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'Kodiak rebases FIFO', actor: user })
      yield* store.update({ id: 1, status: 'doing', actor: user })

      const applied = yield* store.applyProposal({
        id: 1,
        proposal: { kind: 'note', status: 'todo', confidence: 0.9, reason: '', source: 'jev', at: 9 },
        actor: { kind: 'system' },
      })
      expect(applied.ok && applied.value.item.kind).toBe('note')
      expect(applied.ok && applied.value.item.status).toBe('doing')
      expect(applied.ok && applied.value.item.events.at(-1)).toEqual({
        at: 9,
        actor: 'system',
        origin: 'system',
        kind: 'triaged',
        detail: 'applied kind note',
        fieldChanges: [{ field: 'kind', before: 'task', after: 'note' }],
      })
    }).pipe(Effect.scoped),
  )

  it.effect('keeps a hesitant proposal until the user accepts it, then treats its values as theirs', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      const parentRef = (yield* store.capture({ text: 'parent epic', actor: user })).item.ref ?? ''
      yield* store.capture({ text: 'paste drops chips', actor: user })
      yield* store.link({ id: 2, link: { type: 'item', target: parentRef, provenance: 'extracted' }, actor: user })
      yield* store.propose({ id: 2, proposal: { kind: 'bug', duplicateOf: 1, confidence: 0.5, reason: 'Broken.', source: 'model', at: 9 } })
      expect((yield* store.list({})).items.find(entry => entry.id === 2)?.proposal?.kind).toBe('bug')

      const accepted = yield* store.applyProposal({ id: 2, actor: user })
      expect(accepted.ok && accepted.value.item.kind).toBe('bug')
      expect(accepted.ok && accepted.value.item.humanFields).toEqual(['kind'])
      expect(accepted.ok && accepted.value.item.links).toEqual([{ type: 'item', target: parentRef, relation: 'duplicates' }])
      expect(accepted.ok && accepted.value.item.proposal).toBeNull()
    }).pipe(Effect.scoped),
  )

  it.effect('resolves the canonical item when a confirmed duplicate is completed', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'canonical work', actor: user })
      const duplicateRef = (yield* store.capture({ text: 'duplicate work', actor: user })).item.ref ?? ''
      yield* store.propose({ id: 2, proposal: { duplicateOf: 1, confidence: 0.9, reason: 'Same work.', source: 'model', at: 9 } })
      yield* store.applyProposal({ id: 2, actor: user })
      yield* store.propose({ id: 2, proposal: { status: 'done', confidence: 0.9, reason: 'Work completed.', source: 'jev', at: 9 } })

      yield* store.applyProposal({ id: 2, actor: user })

      const duplicate = yield* store.get(2)
      const canonical = yield* store.get(1)
      expect(duplicate.ok && duplicate.value.item.status).toBe('done')
      expect(canonical.ok && canonical.value.item.status).toBe('done')
      expect(canonical.ok && canonical.value.item.events.at(-1)?.detail).toBe(`inbox → done (duplicate b:${duplicateRef} resolved)`)
    }).pipe(Effect.scoped),
  )

  it.effect('closes the canonical item when an agent marks its confirmed duplicate done', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'canonical work', actor: user })
      yield* store.capture({ text: 'duplicate work', actor: user })
      yield* store.propose({ id: 2, proposal: { duplicateOf: 1, confidence: 0.9, reason: 'Same work.', source: 'model', at: 9 } })
      yield* store.applyProposal({ id: 2, actor: user })

      yield* store.update({ id: 2, status: 'done', actor: agent })

      const canonical = yield* store.get(1)
      expect(canonical.ok && canonical.value.item.status).toBe('done')
    }).pipe(Effect.scoped),
  )

  it.effect('leaves a canonical item whose status the user chose untouched when its duplicate is completed', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'canonical work', actor: user })
      yield* store.capture({ text: 'duplicate work', actor: user })
      yield* store.update({ id: 1, status: 'doing', actor: user })
      yield* store.propose({ id: 2, proposal: { duplicateOf: 1, confidence: 0.9, reason: 'Same work.', source: 'model', at: 9 } })
      yield* store.applyProposal({ id: 2, actor: user })
      yield* store.propose({ id: 2, proposal: { status: 'done', confidence: 0.9, reason: 'Work completed.', source: 'jev', at: 9 } })

      yield* store.applyProposal({ id: 2, actor: user })

      const canonical = yield* store.get(1)
      expect(canonical.ok && canonical.value.item.status).toBe('doing')
    }).pipe(Effect.scoped),
  )

  it.effect('clears agent attention when a done suggestion is accepted', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'resolve the integrated change', actor: user })
      yield* store.update({ id: 1, attention: 'blocked', actor: agent })
      yield* store.propose({ id: 1, proposal: { status: 'done', confidence: 0.9, reason: 'resolved', source: 'jev', at: 9 } })

      const accepted = yield* store.applyProposal({ id: 1, actor: user })

      expect(accepted.ok && accepted.value.item.status).toBe('done')
      expect(accepted.ok && accepted.value.item.attention).toBe('none')
      expect((yield* store.list({ inbox: true })).total).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('dismisses a proposal without changing the item', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'an idea', actor: user })
      yield* store.propose({ id: 1, proposal: { kind: 'idea', confidence: 0.4, reason: '', source: 'jev', at: 9 } })
      const dismissed = yield* store.dismissProposal({ id: 1, actor: user })
      expect(dismissed.ok && dismissed.value.item.kind).toBe('task')
      expect(dismissed.ok && dismissed.value.item.proposal).toBeNull()
      expect(dismissed.ok && dismissed.value.item.events.at(-1)?.detail).toBe('dismissed kind idea')
    }).pipe(Effect.scoped),
  )
})

describe('lifecycle signals', () => {
  it.effect('moves an item forward on a signal, records the link, and never moves it back', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'ship the board', actor: user })

      const started = yield* store.applySignal({ id: 1, status: 'doing', link: { type: 'thread', target: 'session-abc123' }, reason: 'mentioned in a thread' })
      expect(started.ok && started.value.item.status).toBe('doing')
      expect(started.ok && started.value.item.events.at(-1)).toEqual({
        at: 9,
        actor: 'system',
        origin: 'system',
        kind: 'moved',
        detail: 'inbox → doing (mentioned in a thread)',
        threadId: 'session-abc123',
        fieldChanges: [{ field: 'status', before: 'inbox', after: 'doing' }],
      })

      yield* store.update({ id: 1, attention: 'blocked', actor: agent })
      const closed = yield* store.applySignal({
        id: 1,
        status: 'done',
        link: { type: 'revision', target: 'kvyxrlmkptyv' },
        reason: 'closed by jj:kvyxrlmkptyv',
      })
      expect(closed.ok && closed.value.item.status).toBe('done')
      expect(closed.ok && closed.value.item.attention).toBe('none')

      const late = yield* store.applySignal({ id: 1, status: 'doing', link: { type: 'thread', target: 'session-later99' }, reason: 'mentioned in a thread' })
      expect(late.ok && late.value.item.status).toBe('done')
      expect(late.ok && late.value.item.links.map(link => link.target)).toEqual(['session-abc123', 'kvyxrlmkptyv', 'session-later99'])
    }).pipe(Effect.scoped),
  )

  it.effect('links but does not move an item whose status the user chose', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'parked on purpose', actor: user })
      yield* store.update({ id: 1, status: 'todo', actor: user })
      const signalled = yield* store.applySignal({
        id: 1,
        status: 'done',
        link: { type: 'revision', target: 'ruwkyzntnvpp' },
        reason: 'closed by jj:ruwkyzntnvpp',
      })
      expect(signalled.ok && signalled.value.item.status).toBe('todo')
      expect(signalled.ok && signalled.value.item.links).toEqual([{ type: 'revision', target: 'ruwkyzntnvpp' }])
    }).pipe(Effect.scoped),
  )
})

describe('thread turn signals', () => {
  const workingItem = Effect.gen(function* () {
    yield* TestClock.setTime(9)
    const store = yield* openStore()
    yield* store.capture({ text: 'rework the composer chips #composer', actor: user })
    yield* store.applySignal({ id: 1, status: 'doing', link: { type: 'thread', target: 'session-abc123' }, reason: 'mentioned in a thread' })
    return store
  })

  it.effect('flags an open item when its thread stopped and clears only that flag when the thread finishes', () =>
    Effect.gen(function* () {
      const store = yield* workingItem
      const flagged = yield* store.applyThreadAttention({ id: 1, threadId: 'session-abc123', attention: 'blocked', reason: 'the thread failed: RATE_LIMIT' })
      expect(flagged.ok && flagged.value.item.attention).toBe('blocked')
      expect(flagged.ok && flagged.value.item.events.at(-1)?.detail).toBe('attention: blocked (the thread failed: RATE_LIMIT)')
      expect(flagged.ok && flagged.value.item.events.at(-1)?.threadId).toBe('session-abc123')
      expect((yield* store.list({ inbox: true })).items.map(item => item.id)).toEqual([1])

      const cleared = yield* store.applyThreadAttention({ id: 1, threadId: 'session-abc123', attention: 'none', reason: 'the thread works again' })
      expect(cleared.ok && cleared.value.item.attention).toBe('none')
      expect(cleared.ok && cleared.value.item.events.at(-1)?.detail).toBe('attention: none (the thread works again)')
      expect(cleared.ok && cleared.value.item.events.at(-1)?.threadId).toBe('session-abc123')
      expect((yield* store.list({ inbox: true })).total).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('leaves an attention the user set by hand, and a closed item, alone', () =>
    Effect.gen(function* () {
      const store = yield* workingItem
      yield* store.update({ id: 1, attention: 'needs-input', actor: user })
      const flagged = yield* store.applyThreadAttention({ id: 1, threadId: 'session-abc123', attention: 'blocked', reason: 'the thread stopped on a block' })
      expect(flagged.ok && flagged.value.item.attention).toBe('needs-input')

      yield* store.update({ id: 1, attention: 'none', status: 'done', actor: user })
      const late = yield* store.applyThreadAttention({ id: 1, threadId: 'session-abc123', attention: 'blocked', reason: 'the thread stopped on a block' })
      expect(late.ok && late.value.item.attention).toBe('none')
      expect(late.ok && late.value.item.status).toBe('done')
    }).pipe(Effect.scoped),
  )

  it.effect('marks old idle thread work waiting once and clears that flag when the thread resumes', () =>
    Effect.gen(function* () {
      const store = yield* workingItem
      const flagged = yield* store.applyThreadAttention({
        id: 1,
        threadId: 'session-abc123',
        attention: 'waiting',
        reason: 'Thread idle nudge: linked thread session-abc123 has been idle for at least 7 days. Is this item still active?',
      })
      expect(flagged.ok && flagged.value.item.attention).toBe('waiting')
      expect(flagged.ok && flagged.value.item.events.at(-1)?.kind).toBe('commented')
      expect(flagged.ok && flagged.value.item.events.at(-1)?.detail).toBe(
        'Thread idle nudge: linked thread session-abc123 has been idle for at least 7 days. Is this item still active?',
      )
      expect(flagged.ok && flagged.value.item.events.at(-1)?.threadId).toBe('session-abc123')
      expect((yield* store.list({ inbox: true })).items.map(item => item.id)).toEqual([1])

      const duplicate = yield* store.applyThreadAttention({
        id: 1,
        threadId: 'session-abc123',
        attention: 'waiting',
        reason: 'Thread idle nudge: linked thread session-abc123 has been idle for at least 7 days. Is this item still active?',
      })
      expect(
        duplicate.ok && duplicate.value.item.events.filter(event => event.kind === 'commented' && event.detail.startsWith('Thread idle nudge:')).length,
      ).toBe(1)

      const resumed = yield* store.applyThreadAttention({ id: 1, threadId: 'session-abc123', attention: 'none', reason: 'the thread works again' })
      expect(resumed.ok && resumed.value.item.attention).toBe('none')
      expect((yield* store.list({ inbox: true })).total).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('keeps a block an agent flagged itself when a later turn finishes', () =>
    Effect.gen(function* () {
      const store = yield* workingItem
      yield* store.update({ id: 1, attention: 'blocked', actor: agent })
      const cleared = yield* store.applyThreadAttention({ id: 1, threadId: 'session-abc123', attention: 'none', reason: 'the thread works again' })
      expect(cleared.ok && cleared.value.item.attention).toBe('blocked')
    }).pipe(Effect.scoped),
  )

  it.effect('settles a request for input once its own thread answered the question', () =>
    Effect.gen(function* () {
      const store = yield* workingItem
      yield* store.update({ id: 1, attention: 'needs-input', actor: agent })
      expect((yield* store.list({ inbox: true })).items.map(item => item.id)).toEqual([1])

      const settled = yield* store.settleAnsweredQuestion({ id: 1, threadId: 'session-abc123', reason: 'the thread’s question was answered' })
      expect(settled.ok && settled.value.item.attention).toBe('none')
      expect(settled.ok && settled.value.item.events.at(-1)?.detail).toBe('attention: none (the thread’s question was answered)')
      expect(settled.ok && settled.value.item.events.at(-1)?.threadId).toBe('session-abc123')
      expect(settled.ok && settled.value.item.humanFields).toEqual([])
      expect((yield* store.list({ inbox: true })).total).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('leaves a request for input another thread raised, or the user set, alone', () =>
    Effect.gen(function* () {
      const store = yield* workingItem
      yield* store.update({ id: 1, attention: 'needs-input', actor: agent })
      const elsewhere = yield* store.settleAnsweredQuestion({ id: 1, threadId: 'session-other', reason: 'another thread answered' })
      expect(elsewhere.ok && elsewhere.value.item.attention).toBe('needs-input')

      yield* store.update({ id: 1, attention: 'none', actor: user })
      yield* store.update({ id: 1, attention: 'needs-input', actor: user })
      const handSet = yield* store.settleAnsweredQuestion({ id: 1, threadId: 'session-abc123', reason: 'the thread’s question was answered' })
      expect(handSet.ok && handSet.value.item.attention).toBe('needs-input')
    }).pipe(Effect.scoped),
  )
})

describe('hiding agent items', () => {
  it.effect('hides items an agent captured until the user touches them, keeps those asking for attention, and counts the rest', () =>
    Effect.gen(function* () {
      const store = yield* openStore()
      const mine = yield* store.capture({ text: 'captured by me', actor: user })
      const untouched = yield* store.capture({ text: 'agent noise', actor: agent })
      const claimed = yield* store.capture({ text: 'agent item I moved', actor: agent })
      const asking = yield* store.capture({ text: 'agent item asking', actor: agent })
      const suggested = yield* store.capture({ text: 'agent item with a suggestion', actor: agent })
      yield* store.update({ id: claimed.item.id, status: 'todo', actor: user })
      yield* store.update({ id: asking.item.id, attention: 'needs-input', actor: agent })
      yield* store.propose({ id: suggested.item.id, proposal: { kind: 'note', confidence: 0.5, reason: 'looks like a note', source: 'jev', at: 0 } })
      yield* store.comment({ id: mine.item.id, text: 'an agent replied', actor: agent })

      const hidden = yield* store.list({ hideAgentItems: true })
      expect(hidden.items.map(item => item.id).sort()).toEqual([mine.item.id, claimed.item.id, asking.item.id, suggested.item.id].sort())
      expect(hidden.hiddenAgentItems).toBe(1)
      expect(hidden.total).toBe(4)

      const everything = yield* store.list({})
      expect(everything.items.map(item => item.id)).toContain(untouched.item.id)
      expect(everything.hiddenAgentItems).toBe(0)

      expect((yield* store.list({ hideAgentItems: true, query: 'noise' })).hiddenAgentItems).toBe(1)
      expect((yield* store.list({ hideAgentItems: true, query: 'captured' })).hiddenAgentItems).toBe(0)
    }).pipe(Effect.scoped),
  )
})

describe('attention and inbox', () => {
  it.effect('puts an item asking for input in the Inbox, keeps it visible, and keeps it there once acknowledged', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0)
      const store = yield* openStore()
      yield* store.capture({ text: 'note: deploy order', actor: user })
      yield* store.update({ id: 1, attention: 'needs-input', actor: agent })
      yield* TestClock.adjust(60 * DAY_MS)

      expect((yield* store.list({})).items.map(item => [item.id, item.freshness, item.attention])).toEqual([[1, 'fresh', 'needs-input']])
      yield* store.acknowledge({ ids: [1] })
      expect((yield* store.list({ inbox: true })).items.map(item => item.acknowledgedAt)).toEqual([60 * DAY_MS])

      yield* store.update({ id: 1, attention: 'none', actor: user })
      expect((yield* store.list({ inbox: true })).total).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('clears stale Inbox state when an item is closed', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'finish the integrated change', actor: user })
      yield* store.update({ id: 1, attention: 'blocked', actor: agent })
      yield* store.propose({ id: 1, proposal: { status: 'done', confidence: 0.9, reason: 'resolved', source: 'jev', at: 9 } })

      const closed = yield* store.update({ id: 1, status: 'done', actor: user })

      expect(closed.ok && closed.value.item.attention).toBe('none')
      expect(closed.ok && closed.value.item.proposal).toBeNull()
      expect(closed.ok && closed.value.item.humanFields).toEqual(['status'])
      expect((yield* store.list({ inbox: true })).total).toBe(0)

      yield* store.update({ id: 1, status: 'doing', actor: user })
      const blockedAgain = yield* store.applyThreadAttention({ id: 1, threadId: 'session-new-work', attention: 'blocked', reason: 'new work stopped' })
      expect(blockedAgain.ok && blockedAgain.value.item.attention).toBe('blocked')
    }).pipe(Effect.scoped),
  )

  it.effect('preserves hand-set attention when an item is closed, but hides it until reopening', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(9)
      const store = yield* openStore()
      yield* store.capture({ text: 'keep this decision visible after reopening', actor: user })
      yield* store.update({ id: 1, attention: 'blocked', actor: user })

      const closed = yield* store.update({ id: 1, status: 'done', actor: user })
      expect(closed.ok && closed.value.item.attention).toBe('blocked')
      expect((yield* store.list({ inbox: true })).total).toBe(0)

      yield* store.update({ id: 1, status: 'doing', actor: user })
      expect((yield* store.list({ inbox: true })).items.map(item => item.id)).toEqual([1])
    }).pipe(Effect.scoped),
  )

  it.effect('keeps legacy closed items out of the Inbox despite stale flags', () =>
    Effect.gen(function* () {
      const rows = backlogRows({
        legacy: { items: [legacyItem({ id: 1, title: 'already closed', status: 'done', humanFields: ['status'], attention: 'blocked' })] },
      })
      yield* TestClock.setTime(9)

      yield* TestClock.setTime(8 * DAY_MS + 9)

      const reopened = yield* openStore(rows)

      expect((yield* reopened.list({ inbox: true })).total).toBe(0)
      expect((yield* reopened.list({ freshness: 'archived' })).items.map(item => item.id)).toEqual([1])
    }).pipe(Effect.scoped),
  )

  it.effect('hides a snoozed item until its time, then lets it resurface', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(0)
      const store = yield* openStore()
      yield* store.capture({ text: 'look at this later', actor: user })
      yield* store.update({ id: 1, snoozedUntil: DAY_MS, actor: user })
      expect((yield* store.list({})).total).toBe(0)
      yield* TestClock.adjust(DAY_MS)
      expect((yield* store.list({})).total).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect('summarizes many agent updates as one activity line', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(3)
      const store = yield* openStore()
      yield* store.capture({ text: 'migrate users table', actor: user })
      yield* store.comment({ id: 1, text: 'read the schema', actor: agent })
      yield* store.comment({ id: 1, text: 'wrote the migration', actor: agent })
      yield* store.update({ id: 1, status: 'doing', actor: agent })
      expect((yield* store.list({})).items[0]?.activity).toEqual({
        count: 3,
        agents: 1,
        comments: 2,
        last: { at: 3, actor: 'agent:session-abc123', kind: 'moved', detail: 'inbox → doing' },
      })
    }).pipe(Effect.scoped),
  )

  it.effect('records each event origin once, keeps it across a restart, and derives it for events written before it', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(3)
      const rows = backlogRows({
        legacy: {
          items: [
            legacyItem({
              id: 1,
              events: [
                { at: 9, actor: 'user', kind: 'created', detail: 'legacy item' },
                { at: 10, actor: 'system', kind: 'commented', detail: 'Linear · Ada: synced before origins' },
              ],
            }),
          ],
        },
      })
      const store = yield* openStore(rows)
      yield* store.comment({ id: 1, text: 'agent progress', actor: agent })
      yield* store.comment({ id: 1, text: 'GitHub · octo: from the tracker', actor: { kind: 'system' }, origin: 'remote:github' })
      const reopened = yield* openStore(rows)
      const detail = yield* reopened.get(1)
      expect(detail.ok && detail.value.item.events.map(event => [event.actor, event.origin])).toEqual([
        ['user', 'user'],
        ['system', 'remote:linear'],
        ['agent:session-abc123', 'agent:session-abc123'],
        ['system', 'remote:github'],
      ])
    }).pipe(Effect.scoped),
  )

  it.effect('stamps who made a link', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(3)
      const store = yield* openStore()
      yield* store.capture({ text: 'parent', actor: user })
      const linked = yield* store.link({ id: 1, link: { type: 'revision', target: 'kvyxrlmkptyv', relation: 'implements' }, actor: agent })
      expect(linked.ok && linked.value.item.links).toEqual([{ type: 'revision', target: 'kvyxrlmkptyv', relation: 'implements', provenance: 'agent' }])
    }).pipe(Effect.scoped),
  )
  it.effect('keeps images and files with an item, reads them back, and removes them', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const rows = backlogRows()
      const store = yield* openStore(rows)
      const detail = yield* store.capture({
        text: 'bug: composer loses pasted screenshots',
        files: [
          { id: 'image-one-1234', kind: 'image', name: 'shot.png', mediaType: 'image/png', bytes: 3, data: 'aGk=' },
          { id: 'file-one-1234', kind: 'file', name: 'spec.pdf', mediaType: 'application/pdf', bytes: 4, data: 'JVBERg==' },
        ],
        actor: user,
      })

      expect(detail.item.attachments.map(attachment => attachment.name)).toEqual(['shot.png', 'spec.pdf'])
      expect((yield* store.list({})).items[0]?.attachments).toHaveLength(2)
      expect(yield* store.readFile({ id: detail.item.id, attachmentId: 'image-one-1234' })).toEqual({
        ok: true,
        value: { dataUrl: 'data:image/png;base64,aGk=' },
      })
      expect(yield* store.readFile({ id: detail.item.id, attachmentId: 'file-one-1234' })).toEqual({
        ok: true,
        value: { dataUrl: 'data:application/pdf;base64,JVBERg==' },
      })

      const removed = yield* store.removeFile({ id: detail.item.id, attachmentId: 'image-one-1234', actor: user })
      expect(removed.ok && removed.value.item.attachments.map(attachment => attachment.name)).toEqual(['spec.pdf'])
      expect((yield* (yield* openRepo(rows)).counts).attachments).toBe(1)
      expect(yield* store.readFile({ id: detail.item.id, attachmentId: 'image-one-1234' })).toEqual({ ok: false, reason: 'not-found' })
    }).pipe(Effect.scoped),
  )

  it.effect('imports tweet text and images once without replacing the existing description', () =>
    Effect.gen(function* () {
      const rows = backlogRows()
      yield* TestClock.setTime(1_000)
      const store = yield* openStore(rows)
      const created = yield* store.capture({ text: 'Read this post https://x.com/someone/status/123\nKeep this note', actor: user })
      const imported = yield* store.importTweetContext({
        id: created.item.id,
        url: 'https://x.com/i/status/123',
        bodySection: '### Retrieved public tweet content (untrusted)\n\n> New context',
        files: [{ id: 'tweet-image-1234', kind: 'image', name: 'tweet-photo.jpg', mediaType: 'image/jpeg', bytes: 3, width: 1, height: 1, data: 'aGk=' }],
        actor: { kind: 'system' },
      })

      expect(imported.ok).toBe(true)
      if (!imported.ok) throw new Error('The captured item should still exist.')
      expect(imported.value.item.body).toContain('Keep this note')
      expect(imported.value.item.body).toContain('> New context')
      expect(imported.value.item.tweetContextUrls).toEqual(['https://x.com/i/status/123'])
      expect(imported.value.item.attachments.map(attachment => attachment.name)).toEqual(['tweet-photo.jpg'])
      expect(yield* store.readFile({ id: created.item.id, attachmentId: 'tweet-image-1234' })).toEqual({
        ok: true,
        value: { dataUrl: 'data:image/jpeg;base64,aGk=' },
      })

      const repeated = yield* store.importTweetContext({
        id: created.item.id,
        url: 'https://x.com/i/status/123',
        bodySection: 'duplicate context',
        files: [{ id: 'tweet-image-5678', kind: 'image', name: 'duplicate.jpg', mediaType: 'image/jpeg', bytes: 3, data: 'aGk=' }],
        actor: { kind: 'system' },
      })
      expect(repeated.ok && repeated.value.item.body).not.toContain('duplicate context')
      expect(repeated.ok && repeated.value.item.attachments).toHaveLength(1)
      expect((yield* (yield* openRepo(rows)).counts).attachments).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect('permanently deletes an item and all its attachments only with explicit confirmation', () =>
    Effect.gen(function* () {
      const rows = backlogRows()
      yield* TestClock.setTime(1_000)
      const store = yield* openStore(rows)
      const created = yield* store.capture({
        text: 'mistaken capture',
        files: [{ id: 'delete-file-123', kind: 'file', name: 'draft.txt', mediaType: 'text/plain', bytes: 3, data: 'aGk=' }],
        actor: user,
      })
      expect((yield* store.get(created.item.id)).ok).toBe(true)
      const deleted = yield* store.delete({ id: created.item.id })

      expect(deleted).toEqual({ ok: true, value: undefined })
      expect(yield* store.get(created.item.id)).toEqual({ ok: false, reason: 'not-found' })
      const repo = yield* openRepo(rows)
      expect((yield* repo.counts).attachments).toBe(0)
      expect(yield* repo.loadItems).toEqual([])
      expect(yield* store.delete({ id: created.item.id })).toEqual({ ok: false, reason: 'not-found' })
    }).pipe(Effect.scoped),
  )

  it.effect('keeps the images a comment carries on its own event and reads them back', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const store = yield* openStore()
      yield* store.capture({ text: 'the description can hold screenshots', actor: user })
      const commented = yield* store.comment({
        id: 1,
        text: 'this is what it looks like',
        files: [{ id: 'comment-image-1', kind: 'image', name: 'reply.png', mediaType: 'image/png', bytes: 3, data: 'aGk=' }],
        actor: user,
      })
      expect(commented.ok).toBe(true)
      const event = commented.ok ? commented.value.item.events.find(candidate => candidate.kind === 'commented') : undefined
      expect(event?.attachments?.map(attachment => attachment.name)).toEqual(['reply.png'])
      expect(commented.ok && commented.value.item.attachments).toEqual([])
      expect(yield* store.readFile({ id: 1, attachmentId: 'comment-image-1' })).toEqual({
        ok: true,
        value: { dataUrl: 'data:image/png;base64,aGk=' },
      })
    }).pipe(Effect.scoped),
  )

  it.effect('edits and deletes only the current user’s replies and removes deleted reply attachments', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const store = yield* openStore()
      yield* store.capture({ text: 'reply editing', actor: user })
      const commented = yield* store.comment({
        id: 1,
        text: 'original reply',
        files: [{ id: 'comment-image-1', kind: 'image', name: 'reply.png', mediaType: 'image/png', bytes: 3, data: 'aGk=' }],
        actor: user,
      })
      expect(commented.ok).toBe(true)
      if (!commented.ok) return
      const commentId = commented.value.item.events.find(event => event.kind === 'commented')?.commentId
      expect(commentId).toBeDefined()
      if (commentId === undefined) return

      const edited = yield* store.editComment({ id: 1, commentId, text: 'updated reply', actor: user })
      expect(edited.ok && edited.value.item.events.some(event => event.commentId === commentId && event.detail === 'updated reply')).toBe(true)
      expect(edited.ok && edited.value.item.events.find(event => event.commentId === commentId)?.attachments?.map(file => file.id)).toEqual(['comment-image-1'])

      const replaced = yield* store.editComment({
        id: 1,
        commentId,
        text: 'reply with a replacement image',
        files: [{ id: 'comment-image-2', kind: 'image', name: 'replacement.png', mediaType: 'image/png', bytes: 5, data: 'aGVsbG8=' }],
        actor: user,
      })
      expect(replaced.ok && replaced.value.item.events.find(event => event.commentId === commentId)?.attachments?.map(file => file.name)).toEqual([
        'replacement.png',
      ])
      expect(yield* store.readFile({ id: 1, attachmentId: 'comment-image-1' })).toEqual({ ok: false, reason: 'not-found' })
      expect(yield* store.readFile({ id: 1, attachmentId: 'comment-image-2' })).toEqual({
        ok: true,
        value: { dataUrl: 'data:image/png;base64,aGVsbG8=' },
      })

      const removed = yield* store.editComment({ id: 1, commentId, text: 'reply without an image', files: [], actor: user })
      expect(removed.ok && removed.value.item.events.find(event => event.commentId === commentId)?.attachments).toEqual([])
      expect(yield* store.readFile({ id: 1, attachmentId: 'comment-image-2' })).toEqual({ ok: false, reason: 'not-found' })
      expect(yield* store.editComment({ id: 1, commentId, text: 'not yours', actor: { kind: 'agent', sessionId: 'other-thread' } })).toEqual({
        ok: false,
        reason: 'not-found',
      })

      const deleted = yield* store.deleteComment({ id: 1, commentId, actor: user })
      expect(deleted.ok && deleted.value.item.events.some(event => event.commentId === commentId)).toBe(false)
      expect(yield* store.readFile({ id: 1, attachmentId: 'comment-image-1' })).toEqual({ ok: false, reason: 'not-found' })
    }).pipe(Effect.scoped),
  )

  it.effect('keeps older user replies editable without stored comment ids', () =>
    Effect.gen(function* () {
      const rows = backlogRows({
        legacy: {
          items: [
            legacyItem({
              id: 1,
              title: 'legacy reply',
              events: [
                { at: 9, actor: 'user', kind: 'created', detail: 'legacy reply' },
                { at: 500, actor: 'user', kind: 'commented', detail: 'written before reply editing' },
              ],
            }),
          ],
        },
      })

      yield* TestClock.setTime(1_000)

      const reopened = yield* openStore(rows)
      const detail = yield* reopened.get(1)
      expect(detail.ok).toBe(true)
      if (!detail.ok) return
      const reply = detail.value.item.events.find(event => event.kind === 'commented')
      expect(reply?.commentId).toMatch(/^legacy-/)
      if (reply?.commentId === undefined) return

      const edited = yield* reopened.editComment({ id: 1, commentId: reply.commentId, text: 'edited legacy reply', actor: user })
      expect(edited.ok && edited.value.item.events.some(event => event.commentId === reply.commentId && event.detail === 'edited legacy reply')).toBe(true)
    }).pipe(Effect.scoped),
  )

  it.effect('takes the kind, status and project the composer set, and records them as the user owns them', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1)
      const store = yield* openStore()
      const detail = yield* store.capture({ text: 'fix the composer', kind: 'bug', status: 'doing', project: '/work/dshfiles', actor: user })
      expect(detail.item.kind).toBe('bug')
      expect(detail.item.status).toBe('doing')
      expect(detail.item.project).toBe('/work/dshfiles')
      expect(detail.item.humanFields).toEqual(['kind', 'status', 'project'])
    }).pipe(Effect.scoped),
  )
})
