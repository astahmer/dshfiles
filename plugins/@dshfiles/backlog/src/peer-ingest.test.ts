import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogReference } from './backlog-reference.js'
import { BacklogRepo, type PeerOpWire } from './backlog-repo.js'
import type { BacklogItem } from './item.js'
import { BacklogOps, type BacklogOpRecord } from './op-log.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const user = { kind: 'user' } as const

const open = (rows = backlogRows()) =>
  Effect.map(Layer.build(backlogStoreLayer({ rows })), context => ({ store: Context.get(context, BacklogStore), repo: Context.get(context, BacklogRepo) }))
type Host = Effect.Success<ReturnType<typeof open>>

const decodeOp = Schema.decodeUnknownEffect(BacklogOps.json)
const recordsOf = (ops: readonly PeerOpWire[]) =>
  Effect.forEach(ops, (wire): Effect.Effect<BacklogOpRecord, unknown> =>
    Effect.map(decodeOp(wire.op), op => ({ opId: wire.opId, itemId: wire.itemId, hlc: wire.hlc, origin: wire.origin, op })),
  )

/** One page of `from`'s log after `cursor`, ingested by `to`; the cursor it reached. */
const pull = (input: { readonly from: Host; readonly to: Host; readonly cursor: number; readonly limit: number }) =>
  Effect.gen(function* () {
    const page = yield* input.from.repo.opsSince({ cursor: input.cursor, limit: input.limit, maxBytes: 4_000_000 })
    const ingested = yield* input.to.store.ingestPeerOps(yield* recordsOf(page.ops))
    return { cursor: page.ops.at(-1)?.seq ?? input.cursor, inserted: ingested.inserted, head: page.head }
  })

/** Every host pulls every other host's whole log until a full round adds nothing: what the peer worker reaches eventually. */
const settle = (hosts: readonly Host[], cursors: Map<string, number>) =>
  Effect.gen(function* () {
    for (let round = 0; round < 10; round += 1) {
      let inserted = 0
      for (const [fromIndex, from] of hosts.entries())
        for (const [toIndex, to] of hosts.entries()) {
          if (fromIndex === toIndex) continue
          const key = `${String(fromIndex)}>${String(toIndex)}`
          for (;;) {
            const page = yield* pull({ from, to, cursor: cursors.get(key) ?? 0, limit: 50 })
            cursors.set(key, page.cursor)
            inserted += page.inserted
            if (page.cursor >= page.head) break
          }
        }
      if (inserted === 0) return
    }
    throw new Error('the hosts did not settle')
  })

const withoutId = (item: BacklogItem) => {
  const { id: _id, ...rest } = item
  return rest
}

/** Every live item a host folds, by canonical id, without the host-local numeric id. */
const snapshot = (host: Host) =>
  Effect.map(host.repo.exportRows, rows =>
    [...rows.items].sort((left, right) => (left.itemId < right.itemId ? -1 : 1)).map(row => ({ itemId: row.itemId, item: withoutId(row.item) })),
  )

const random = (seed: number) => {
  const state = { value: seed >>> 0 }
  return (bound: number): number => {
    state.value = (state.value + 0x6d2b79f5) >>> 0
    let mixed = state.value
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return (((mixed ^ (mixed >>> 14)) >>> 0) % 2 ** 32) % bound
  }
}

const statuses = ['inbox', 'todo', 'doing', 'done', 'dropped'] as const

/** One random write on `host`: a capture, an edit, a tag change, a comment or a delete of an item it knows. */
const randomWrite = (host: Host, pick: (bound: number) => number) =>
  Effect.gen(function* () {
    const items = (yield* host.store.list({ freshness: 'all', limit: 2_000 })).items
    const target = items[pick(Math.max(1, items.length))]
    const choice = target === undefined ? 0 : pick(7)
    if (choice === 0 || target === undefined)
      return yield* Effect.asVoid(host.store.capture({ text: `item ${String(pick(1_000))} #t${String(pick(4))}`, actor: user }))
    if (choice === 1) return yield* Effect.asVoid(host.store.update({ id: target.id, status: statuses[pick(statuses.length)] ?? 'todo', actor: user }))
    if (choice === 2) return yield* Effect.asVoid(host.store.update({ id: target.id, title: `renamed ${String(pick(1_000))}`, actor: user }))
    if (choice === 3) return yield* Effect.asVoid(host.store.update({ id: target.id, tags: [`t${String(pick(4))}`, `u${String(pick(3))}`], actor: user }))
    if (choice === 4)
      return yield* Effect.asVoid(host.store.link({ id: target.id, link: { type: 'url', target: `https://example.com/${String(pick(5))}` }, actor: user }))
    if (choice === 5) return yield* Effect.asVoid(host.store.comment({ id: target.id, text: `reply ${String(pick(1_000))}`, actor: user }))
    return pick(4) === 0 ? yield* Effect.asVoid(host.store.delete({ id: target.id })) : undefined
  })

describe('peer replication of the op log', () => {
  it.effect('converges whatever order concurrent ops arrive in, across three hosts', () =>
    Effect.gen(function* () {
      for (const seed of [1, 7, 42, 2026, 31_337]) {
        yield* TestClock.setTime(1_000)
        const pick = random(seed)
        const hosts = [yield* open(), yield* open(), yield* open()]
        const cursors = new Map<string, number>()
        for (let step = 0; step < 60; step += 1) {
          yield* TestClock.adjust(pick(3))
          const host = hosts[pick(hosts.length)]
          if (host !== undefined) yield* randomWrite(host, pick)
          if (pick(4) !== 0) continue
          const fromIndex = pick(hosts.length)
          const toIndex = (fromIndex + 1 + pick(hosts.length - 1)) % hosts.length
          const from = hosts[fromIndex]
          const to = hosts[toIndex]
          if (from === undefined || to === undefined) continue
          const key = `${String(fromIndex)}>${String(toIndex)}`
          const before = cursors.get(key) ?? 0
          const page = yield* pull({ from, to, cursor: before, limit: 1 + pick(8) })
          // A page delivered twice changes nothing the second time.
          if (pick(3) === 0) expect((yield* pull({ from, to, cursor: before, limit: page.cursor - before || 1 })).inserted).toBe(0)
          cursors.set(key, page.cursor)
        }
        yield* settle(hosts, cursors)
        const [first, ...others] = yield* Effect.forEach(hosts, snapshot)
        expect(first?.length).toBeGreaterThan(0)
        for (const other of others) expect(other).toEqual(first)
      }
    }),
  )

  it.effect('resumes from its cursor, serves ops it learned from another host, and reports the head', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(5_000)
      const [a, b, c] = [yield* open(), yield* open(), yield* open()]
      const captured = yield* a.store.capture({ text: 'shared item', actor: user })
      yield* a.store.comment({ id: captured.item.id, text: 'first', actor: user })
      yield* a.store.comment({ id: captured.item.id, text: 'second', actor: user })
      const firstPage = yield* pull({ from: a, to: b, cursor: 0, limit: 1 })
      expect(firstPage.head).toBeGreaterThan(firstPage.cursor)
      const rest = yield* pull({ from: a, to: b, cursor: firstPage.cursor, limit: 100 })
      expect(rest.cursor).toBe(rest.head)
      // C never talks to A: B serves A's ops too, so the chain A → B → C converges.
      yield* pull({ from: b, to: c, cursor: 0, limit: 100 })
      expect(yield* snapshot(c)).toEqual(yield* snapshot(a))
      const onC = yield* c.store.resolve(`b:${BacklogReference.refOf(captured.item)}`)
      expect(onC).toBeDefined()
    }),
  )

  it.effect('keeps a clashing ref on the older item and gives the newer one the same new ref on every host', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(10_000)
      const [a, b] = [yield* open(), yield* open()]
      const item = (createdAt: number, title: string): BacklogItem => ({
        id: 1,
        ref: 'k3f9',
        title,
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
        createdAt,
        lastActivityAt: createdAt,
        events: [{ at: createdAt, actor: 'user', kind: 'created', detail: title }],
      })
      yield* a.repo.create({ item: item(100, 'older on A'), origin: 'user', nextId: 2, files: [] })
      yield* b.repo.create({ item: item(200, 'newer on B'), origin: 'user', nextId: 2, files: [] })
      yield* settle([a, b], new Map())
      const onA = yield* snapshot(a)
      expect(yield* snapshot(b)).toEqual(onA)
      const older = onA.find(row => row.item.title === 'older on A')
      const newer = onA.find(row => row.item.title === 'newer on B')
      expect(older?.item.ref).toBe('k3f9')
      expect(newer?.item.ref).toMatch(/^[0-9a-hjkmnp-tv-z]{5}$/)
      expect(newer?.item.events.at(-1)?.detail).toBe(`b:k3f9 was also given to an older item on another Host, so this item is now b:${newer?.item.ref ?? ''}.`)
      const renames = (yield* a.repo.exportRows).ops.filter(record => record.op.kind === 'rename-ref')
      expect(renames).toHaveLength(1)
      expect(yield* b.store.resolve('b:k3f9')).toBe(yield* b.store.resolve(`b:k3f9`))
      const resolvedOnB = yield* b.store.get((yield* b.store.resolve('b:k3f9')) ?? 0)
      expect(resolvedOnB.ok && resolvedOnB.value.item.title).toBe('older on A')
    }),
  )

  it.effect('replicates a merge redirect, so the duplicate ref opens the survivor on the other host', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(20_000)
      const [a, b] = [yield* open(), yield* open()]
      const survivor = (yield* a.store.capture({ text: 'composer drops chips', actor: user })).item
      const duplicate = (yield* a.store.capture({ text: 'chips vanish', actor: user })).item
      yield* settle([a, b], new Map())
      const cursors = new Map<string, number>()
      yield* settle([a, b], cursors)
      const merged = yield* a.store.merge({ survivorId: survivor.id, duplicateIds: [duplicate.id], actor: user })
      expect(merged.ok).toBe(true)
      yield* settle([a, b], cursors)
      const survivorOnB = yield* b.store.resolve(`b:${BacklogReference.refOf(survivor)}`)
      expect(survivorOnB).toBeDefined()
      expect(yield* b.store.resolve(`b:${BacklogReference.refOf(duplicate)}`)).toBe(survivorOnB)
      const refused = yield* Effect.flip(
        b.store.merge({ survivorId: survivorOnB ?? 0, duplicateIds: [(yield* b.store.resolve(duplicate.id)) ?? 0], actor: user }),
      )
      expect(refused._tag).toBe('BacklogMergeInvalid')
    }),
  )

  it.effect('shows another host’s legacy item under a derived ref that resolves on both hosts, never as a local b:<n>', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(30_000)
      const legacy: BacklogItem = {
        id: 12,
        title: 'legacy twelve',
        body: '',
        kind: 'task',
        status: 'todo',
        project: null,
        tags: [],
        links: [],
        attachments: [],
        actors: [{ id: 'user', role: 'owner' }],
        pinned: false,
        humanFields: [],
        createdAt: 100,
        lastActivityAt: 100,
        events: [{ at: 100, actor: 'user', kind: 'created', detail: 'legacy twelve' }],
      }
      const a = yield* open(backlogRows({ legacy: { items: [legacy] } }))
      const b = yield* open()
      yield* settle([a, b], new Map())
      const onB = (yield* b.store.list({ freshness: 'all', limit: 10 })).items
      expect(onB).toHaveLength(1)
      const derived = onB[0]?.ref ?? ''
      expect(derived).toMatch(/^[0-9a-hjkmnp-tv-z]{5}$/)
      expect(yield* b.store.resolve('b:12')).toBeUndefined()
      expect(yield* a.store.resolve('b:12')).toBe(12)
      expect(yield* a.store.resolve(`b:${derived}`)).toBe(12)
      const onA = yield* a.store.get(12)
      expect(onA.ok && onA.value.item.ref).toBeUndefined()
    }),
  )

  it.effect('spawns one next occurrence when two hosts finish the same recurring item', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(40_000)
      const [a, b] = [yield* open(), yield* open()]
      const recurring = (yield* a.store.capture({ text: 'water the plants', recurrence: 'daily', due: '2026-11-06', actor: user })).item
      const cursors = new Map<string, number>()
      yield* settle([a, b], cursors)
      const onB = (yield* b.store.resolve(`b:${BacklogReference.refOf(recurring)}`)) ?? 0
      yield* a.store.update({ id: recurring.id, status: 'done', actor: user })
      yield* TestClock.adjust(3)
      yield* b.store.update({ id: onB, status: 'done', actor: user })
      yield* settle([a, b], cursors)
      const open_ = (host: Host) =>
        Effect.map(host.store.list({ freshness: 'all', statuses: ['todo'], limit: 10 }), list => list.items.filter(item => item.title === 'water the plants'))
      expect(yield* open_(a)).toHaveLength(1)
      expect(yield* open_(b)).toHaveLength(1)
      expect(yield* snapshot(b)).toEqual(yield* snapshot(a))
    }),
  )
})
