import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogOrigins } from './event-origin.js'
import type { BacklogItem } from './item.js'
import { BacklogOps } from './op-log.js'
import { BacklogStore } from './store.js'
import type { SyncMapping } from './sync-model.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'
import { ulidPattern } from './ulid.js'

const user = { kind: 'user' } as const
const agent = { kind: 'agent', sessionId: 'session-abc123', cwd: '/work/dshfiles' } as const

const open = (rows = backlogRows()) =>
  Effect.map(Layer.build(backlogStoreLayer({ rows })), context => ({ store: Context.get(context, BacklogStore), repo: Context.get(context, BacklogRepo) }))

const storedItems = (store: BacklogStore['Service'], ids: readonly number[]) =>
  Effect.map(store.getMany(ids), result => result.items.map(detail => withoutFreshness(detail.item)))

/** The stored item a detail serves: without the derived freshness and the ids a detail invents for legacy replies. */
const withoutFreshness = (item: BacklogItem & { readonly freshness?: unknown }): BacklogItem => {
  const { freshness: _freshness, ...rest } = item
  return {
    ...rest,
    events: rest.events.map(event => {
      if (event.commentId?.startsWith('legacy-') !== true) return event
      const { commentId: _commentId, ...stored } = event
      return stored
    }),
  }
}

const byId = (items: readonly BacklogItem[]) => [...items].sort((left, right) => left.id - right.id)

const legacyItem = (fields: Partial<BacklogItem> & Pick<BacklogItem, 'id'>): BacklogItem => ({
  title: `legacy ${String(fields.id)}`,
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
  createdAt: 100,
  lastActivityAt: 100,
  events: [{ at: 100, actor: 'user', kind: 'created', detail: `legacy ${String(fields.id)}` }],
  ...fields,
})

const mapping = (itemId: number): SyncMapping => ({
  itemId,
  backend: 'linear',
  remoteId: 'remote-1',
  remoteKey: 'ENG-1',
  url: 'https://linear.app/acme/issue/ENG-1',
  linkedAt: 100,
  lastSyncedAt: null,
  remoteUpdatedAt: null,
  localSyncedAt: null,
  base: null,
  comments: [],
  pushCommentsSince: 100,
  state: 'pending',
  conflicts: [],
  lastError: null,
})

describe('hybrid logical clock', () => {
  it('moves with the wall clock and counts stamps within one millisecond, even when the clock goes back', () => {
    const first = BacklogOps.nextHlc({ previous: null, now: 10, host: 'a' })
    const second = BacklogOps.nextHlc({ previous: first, now: 10, host: 'a' })
    const behind = BacklogOps.nextHlc({ previous: second, now: 5, host: 'a' })
    const ahead = BacklogOps.nextHlc({ previous: behind, now: 11, host: 'a' })

    expect([first, second, behind, ahead].map(stamp => [stamp.wall, stamp.counter])).toEqual([
      [10, 0],
      [10, 1],
      [10, 2],
      [11, 0],
    ])
    expect(BacklogOps.compareHlc(second, behind)).toBeLessThan(0)
  })
})

describe('the op log', () => {
  it.effect('folds back to exactly the items the store serves, after every kind of write and a restart', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const rows = backlogRows()
      const { store, repo } = yield* open(rows)
      const first = yield* store.capture({
        text: 'bug: composer drops chips #composer see b:2',
        files: [{ id: 'capture-file-1', kind: 'image', name: 'shot.png', mediaType: 'image/png', bytes: 2, data: 'aGk=' }],
        actor: user,
      })
      const second = yield* store.capture({ text: 'wire jj signals', actor: agent })
      const id = first.item.id
      yield* TestClock.adjust(5)
      yield* store.update({ id, status: 'doing', tags: ['composer', 'ux'], title: 'Composer drops chips', actor: user })
      yield* store.link({ id, link: { type: 'revision', target: 'kvyxrlmk' }, actor: agent })
      const commented = yield* store.comment({
        id,
        text: 'repro attached',
        files: [{ id: 'comment-file-1', kind: 'file', name: 'log.txt', mediaType: 'text/plain', bytes: 2, data: 'aGk=' }],
        actor: user,
      })
      const commentId = commented.ok ? commented.value.item.events.findLast(event => event.kind === 'commented')?.commentId : undefined
      if (commentId === undefined) throw new Error('The comment should have an id.')
      yield* store.comment({ id, text: 'second reply', actor: user })
      yield* store.editComment({ id, commentId, text: 'repro attached (edited)', files: [], actor: user })
      yield* store.attachFile({ id, file: { id: 'later-file-12', kind: 'file', name: 'b.txt', mediaType: 'text/plain', bytes: 2, data: 'aG8=' }, actor: user })
      yield* store.removeFile({ id, attachmentId: 'capture-file-1', actor: user })
      yield* store.propose({ id, proposal: { kind: 'bug', confidence: 0.5, reason: 'looks like a bug', source: 'jev', at: 1_005 } })
      yield* store.applyProposal({ id, actor: user })
      yield* store.markTriaged(second.item.id)
      yield* store.acknowledge({ ids: [id] })
      yield* store.update({ id, attention: 'needs-input', snoozedUntil: 9_000, actor: user })
      yield* store.update({ id: second.item.id, status: 'done', actor: agent })
      const third = yield* store.capture({ text: 'mistaken capture', actor: user })
      yield* store.delete({ id: third.item.id })

      const served = yield* storedItems(store, [id, second.item.id])
      expect(byId(yield* repo.foldAll)).toEqual(byId(served))
      expect(byId(yield* repo.loadItems)).toEqual(byId(served))

      const reopened = yield* open(rows)
      expect(byId(yield* storedItems(reopened.store, [id, second.item.id]))).toEqual(byId(served))
      expect((yield* reopened.store.get(third.item.id)).ok).toBe(false)

      const kinds = (yield* repo.opsOf(id)).map(record => record.op.kind)
      expect(kinds[0]).toBe('create')
      expect(kinds).toEqual(expect.arrayContaining(['set', 'add', 'attach', 'detach', 'event', 'comment', 'comment-edit']))
      expect(Option.getOrThrow(yield* repo.canonicalId(id))).toMatch(ulidPattern)
    }).pipe(Effect.scoped),
  )

  it.effect('keeps every event instead of trimming the history at 200', () =>
    Effect.gen(function* () {
      const rows = backlogRows()
      const { store } = yield* open(rows)
      const created = yield* store.capture({ text: 'chatty item', actor: agent })
      for (let index = 0; index < 205; index++) yield* store.comment({ id: created.item.id, text: `progress ${String(index)}`, actor: agent })

      const reopened = yield* open(rows)
      const detail = yield* reopened.store.get(created.item.id)
      expect(detail.ok && detail.value.item.events).toHaveLength(206)
      expect(detail.ok && detail.value.item.events[0]?.kind).toBe('created')
    }).pipe(Effect.scoped),
  )

  it.effect('stores identical bytes once and drops them only when no attachment uses them', () =>
    Effect.gen(function* () {
      const rows = backlogRows()
      const { store } = yield* open(rows)
      const file = (id: string) => ({ id, kind: 'file' as const, name: `${id}.txt`, mediaType: 'text/plain', bytes: 2, data: 'aGk=' })
      const one = yield* store.capture({ text: 'one', files: [file('same-bytes-1')], actor: user })
      yield* store.capture({ text: 'two', files: [file('same-bytes-2')], actor: user })
      const blobFiles = () =>
        readdirSync(rows.files, { recursive: true, withFileTypes: true })
          .filter(entry => entry.isFile())
          .map(entry => join(entry.parentPath, entry.name))

      expect(blobFiles()).toHaveLength(1)
      yield* store.delete({ id: one.item.id })
      expect(blobFiles()).toHaveLength(1)
      expect(yield* store.readFile({ id: 2, attachmentId: 'same-bytes-2' })).toEqual({ ok: true, value: { dataUrl: 'data:text/plain;base64,aGk=' } })
      yield* store.removeFile({ id: 2, attachmentId: 'same-bytes-2', actor: user })
      expect(blobFiles()).toHaveLength(0)
    }).pipe(Effect.scoped),
  )
})

describe('the legacy import', () => {
  it.effect('imports the JSON domains once, with their files, mappings and id counter, and records one bounded span', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans[Symbol.dispose]()),
      )
      const attachment = { id: 'legacy-file-1', kind: 'image' as const, name: 'shot.png', mediaType: 'image/png', bytes: 2, createdAt: 150 }
      const legacy = [
        legacyItem({
          id: 3,
          tags: ['ux'],
          links: [{ type: 'thread', target: 'session-abc123' }],
          actors: [
            { id: 'agent:session-abc123', role: 'owner' },
            { id: 'user', role: 'contributor' },
          ],
          attachments: [attachment],
          status: 'doing',
          project: '/work/dshfiles-threads/thread-1',
          lastActivityAt: 300,
          attention: 'waiting',
          events: [
            { at: 100, actor: 'agent:session-abc123', kind: 'created', detail: 'legacy 3' },
            { at: 200, actor: 'user', kind: 'moved', detail: 'inbox → doing', fieldChanges: [{ field: 'status', before: 'inbox', after: 'doing' }] },
            { at: 300, actor: 'user', kind: 'commented', detail: 'a reply from before comment ids' },
          ],
        }),
        legacyItem({ id: 7, events: [{ at: 120, actor: 'user', kind: 'commented', detail: 'history that lost its created event' }] }),
      ]
      const rows = backlogRows({
        legacy: {
          items: legacy,
          files: [
            { itemId: 3, attachment, data: 'aGk=' },
            { itemId: 99, attachment: { ...attachment, id: 'orphan-file-1' }, data: 'aGk=' },
          ],
          mappings: [['3', mapping(3)]],
          nextId: 9,
        },
      })
      const { store, repo } = yield* open(rows)

      const expected = [{ ...legacy[0], project: '/work/dshfiles' }, legacy[1]].flatMap(item => (item === undefined ? [] : [item]))
      // The import rewrites no op: the log folds back to the legacy events, and only a read derives their origin.
      expect(byId(yield* repo.foldAll)).toEqual(expected)
      expect(byId(yield* storedItems(store, [3, 7]))).toEqual(expected.map(item => ({ ...item, events: (item.events ?? []).map(BacklogOrigins.stamped) })))
      expect(yield* store.readFile({ id: 3, attachmentId: 'legacy-file-1' })).toEqual({ ok: true, value: { dataUrl: 'data:image/png;base64,aGk=' } })
      expect(Option.getOrThrow(yield* repo.mappings.get('3'))).toEqual(mapping(3))
      expect((yield* store.capture({ text: 'next', actor: user })).item.id).toBe(9)
      expect(Option.getOrThrow(yield* repo.importReport)).toMatchObject({ items: 2, files: 1, blobs: 1, orphanFiles: 1, mappings: 1, nextId: 9 })

      const span = recorder.span('backlog legacy import')
      expect(span.attributes['dshx.backlog.import.items']).toBe(2)
      expect(span.attributes['dshx.backlog.import.orphan_files']).toBe(1)

      const counts = yield* repo.counts
      const reopened = yield* open({ ...rows, legacy: { items: [legacyItem({ id: 42 })] } })
      expect(yield* reopened.repo.counts).toEqual(counts)
      expect((yield* reopened.store.get(42)).ok).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )

  it.effect('starts empty and never imports later when the JSON domains held nothing', () =>
    Effect.gen(function* () {
      const rows = backlogRows()
      const { repo } = yield* open(rows)
      expect(Option.getOrThrow(yield* repo.importReport)).toMatchObject({ items: 0, ops: 0 })

      const reopened = yield* open({ ...rows, legacy: { items: [legacyItem({ id: 1 })] } })
      expect(yield* reopened.repo.loadItems).toEqual([])
    }).pipe(Effect.scoped),
  )
})

describe('short aliases', () => {
  it.effect('gives a new item a fixed short alias while legacy numbers keep resolving, across a restart', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const rows = backlogRows({ legacy: { items: [legacyItem({ id: 3 })], files: [], mappings: [], nextId: 9 } })
      const { store } = yield* open(rows)
      const created = yield* store.capture({ text: 'fresh work, see b:3', actor: user })
      const ref = created.item.ref ?? ''

      expect(ref).toMatch(/^[0-9a-hjkmnp-tv-z]{4}$/u)
      expect(/[a-z]/u.test(ref)).toBe(true)
      expect(created.item.id).toBe(9)
      expect(created.item.links).toEqual([{ type: 'item', target: '3', provenance: 'extracted' }])
      expect((yield* store.list({})).items.map(item => [item.id, item.ref])).toEqual(
        expect.arrayContaining([
          [3, '3'],
          [9, ref],
        ]),
      )

      expect(yield* store.resolve('3')).toBe(3)
      expect(yield* store.resolve('b:3')).toBe(3)
      expect(yield* store.resolve(ref)).toBe(9)
      expect(yield* store.resolve(`b:${ref.toUpperCase()}`)).toBe(9)
      expect(yield* store.resolve(9)).toBe(9)
      // A new item's number is private: written as `b:9` it names nothing.
      expect(yield* store.resolve('9')).toBeUndefined()
      expect(yield* store.resolve('zzzz')).toBeUndefined()

      const legacyDetail = yield* store.get(3)
      expect(legacyDetail.ok && legacyDetail.value.backlinks.map(item => item.id)).toEqual([9])

      const reopened = yield* open(rows)
      const again = yield* reopened.store.get(9)
      expect(again.ok && again.value.item.ref).toBe(ref)
      expect(yield* reopened.store.resolve(ref)).toBe(9)
      expect(yield* reopened.store.resolve('3')).toBe(3)
      expect((yield* reopened.store.capture({ text: 'another', actor: user })).item.ref).not.toBe(ref)
    }).pipe(Effect.scoped),
  )
})

describe('revert from history', () => {
  const changeAt = (item: BacklogItem, field: string): number => {
    const event = item.events.findLast(candidate => candidate.fieldChanges?.some(change => change.field === field) === true)
    if (event === undefined) throw new Error(`No recorded ${field} change.`)
    return event.at
  }

  it.effect('writes back the typed value a field held before the change, as a new set op, and refuses a stale one', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const { store, repo } = yield* open()
      const created = yield* store.capture({ text: 'Original title', actor: user })
      const id = created.item.id
      yield* TestClock.adjust(10)
      yield* store.update({ id, title: 'Renamed title', tags: ['infra', 'ux'], status: 'doing', actor: user })
      yield* TestClock.adjust(10)
      const edited = yield* store.update({ id, tags: ['infra'], actor: user })
      if (!edited.ok) throw new Error('The item should exist.')
      const renamedAt = changeAt(edited.value.item, 'title')
      const tagsAt = changeAt(edited.value.item, 'tags')
      const opsBefore = (yield* repo.opsOf(id)).length

      yield* TestClock.adjust(10)
      const reverted = yield* store.revert({ id, at: renamedAt, field: 'title', actor: user })
      expect(reverted.ok && reverted.value.item.title).toBe('Original title')
      expect(reverted.ok && reverted.value.item.events.at(-1)).toMatchObject({
        kind: 'edited',
        detail: 'reverted title',
        fieldChanges: [{ field: 'title', before: 'Renamed title', after: 'Original title' }],
      })
      const appended = (yield* repo.opsOf(id)).slice(opsBefore).map(record => record.op)
      expect(appended).toContainEqual({ kind: 'set', field: 'title', value: 'Original title' })

      // Tags are a typed list, not the "infra, ux" the event displays.
      const tags = yield* store.revert({ id, at: tagsAt, field: 'tags', actor: user })
      expect(tags.ok && tags.value.item.tags).toEqual(['infra', 'ux'])

      // The status went inbox → doing in the first update; it has not changed since.
      const status = yield* store.revert({ id, at: renamedAt, field: 'status', actor: user })
      expect(status.ok && status.value.item.status).toBe('inbox')

      // The title change of the first update was reverted since, so reverting it again would undo that revert.
      const stale = yield* store.revert({ id, at: renamedAt, field: 'title', actor: user })
      expect(stale).toMatchObject({ ok: false, reason: 'stale' })
      expect(!stale.ok && stale.reason === 'stale' && stale.message).toMatch(/changed again since .*Revert that later change first/u)

      expect((yield* store.revert({ id, at: 1, field: 'title', actor: user })).ok).toBe(false)
      expect(yield* store.revert({ id: 999, at: renamedAt, field: 'title', actor: user })).toEqual({ ok: false, reason: 'not-found' })

      const folded = (yield* repo.foldAll).find(item => item.id === id)
      const served = yield* store.get(id)
      expect(served.ok && folded).toEqual(served.ok ? withoutFreshness(served.value.item) : undefined)
    }).pipe(Effect.scoped),
  )
})
