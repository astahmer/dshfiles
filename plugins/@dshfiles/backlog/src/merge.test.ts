import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogReference } from './backlog-reference.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const user = { kind: 'user' } as const
const agent = { kind: 'agent', sessionId: 'session-merge01', cwd: '/work/dshfiles' } as const

describe('duplicate merge', () => {
  it.effect('moves comments, links, tags and sub-issues to the survivor, drops the duplicate and redirects its reference', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const rows = backlogRows()
      const store = yield* Effect.map(Layer.build(backlogStoreLayer({ rows })), context => Context.get(context, BacklogStore))
      const survivor = (yield* store.capture({ text: 'composer drops chips #composer', actor: user })).item
      const duplicate = (yield* store.capture({ text: 'chips vanish on paste #paste https://example.com/report', actor: user })).item
      const duplicateRef = BacklogReference.refOf(duplicate)
      const survivorRef = BacklogReference.refOf(survivor)
      yield* store.comment({ id: duplicate.id, text: 'seen on Safari too', actor: agent })
      const child = (yield* store.capture({ text: 'add a paste regression test', parent: duplicateRef, actor: user })).item
      const pointing = (yield* store.capture({ text: `follow-up of b:${duplicateRef}`, actor: user })).item

      const merged = yield* store.merge({ survivorId: survivor.id, duplicateIds: [duplicate.id], actor: user })
      if (!merged.ok) throw new Error('the merge was refused')
      expect(merged.value.merged).toEqual([duplicateRef])
      expect(merged.value.item.tags).toEqual(['composer', 'paste'])
      expect(merged.value.item.links).toContainEqual(expect.objectContaining({ type: 'url', target: 'https://example.com/report' }))
      const moved = merged.value.item.events.filter(event => event.kind === 'commented')
      expect(moved).toEqual([expect.objectContaining({ actor: 'agent:session-merge01', detail: `Moved from b:${duplicateRef}:\n\nseen on Safari too` })])
      expect(merged.value.children.map(entry => entry.id)).toEqual([child.id])

      const dropped = yield* store.get(duplicate.id)
      expect(dropped.ok && dropped.value.item.status).toBe('dropped')
      expect(dropped.ok && dropped.value.item.links).toContainEqual(expect.objectContaining({ type: 'item', target: survivorRef, relation: 'duplicates' }))
      const rewritten = yield* store.get(pointing.id)
      expect(rewritten.ok && rewritten.value.item.links.filter(link => link.type === 'item').map(link => link.target)).toEqual([survivorRef])
      expect(yield* store.resolve(`b:${duplicateRef}`)).toBe(survivor.id)
      expect(yield* store.resolve(duplicate.id)).toBe(duplicate.id)

      const refused = yield* Effect.flip(store.merge({ survivorId: survivor.id, duplicateIds: [duplicate.id], actor: user }))
      expect(refused._tag).toBe('BacklogMergeInvalid')
      expect((yield* Effect.flip(store.merge({ survivorId: survivor.id, duplicateIds: [survivor.id], actor: user })))._tag).toBe('BacklogMergeInvalid')
    }).pipe(Effect.scoped),
  )

  it.effect('keeps the redirect across a restart of the store', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const rows = backlogRows()
      const first = yield* Effect.map(Layer.build(backlogStoreLayer({ rows })), context => Context.get(context, BacklogStore))
      const survivor = (yield* first.capture({ text: 'keep me', actor: user })).item
      const duplicate = (yield* first.capture({ text: 'merge me', actor: user })).item
      yield* first.merge({ survivorId: survivor.id, duplicateIds: [duplicate.id], actor: user })
      const reopened = yield* Effect.map(Layer.build(backlogStoreLayer({ rows })), context => Context.get(context, BacklogStore))
      expect(yield* reopened.resolve(BacklogReference.refOf(duplicate))).toBe(survivor.id)
    }).pipe(Effect.scoped),
  )
})
