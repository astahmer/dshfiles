import { describe, expect, it } from '@effect/vitest'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Context, Effect, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogItems } from './item.js'
import { LeaseEndings } from './lease-sweep.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const MINUTE_MS = 60_000

const openStore = (rows = backlogRows()) => Effect.map(Layer.build(backlogStoreLayer({ rows })), context => Context.get(context, BacklogStore))

const user = { kind: 'user' } as const
const agentA = { kind: 'agent', sessionId: 'session-aaaaaa', cwd: '/work/repo' } as const
const agentB = { kind: 'agent', sessionId: 'session-bbbbbb', cwd: '/work/repo' } as const

const refOf = (detail: { readonly item: { readonly id: number; readonly ref?: string | undefined } }): string => detail.item.ref ?? String(detail.item.id)

describe('priority', () => {
  it('reads `!1`…`!4` from the capture and leaves it out of the title', () => {
    expect(BacklogItems.triage('!1 fix the release').priority).toBe('urgent')
    expect(BacklogItems.triage('bug: crash on save !3').priority).toBe('medium')
    expect(BacklogItems.triage('bug: crash on save !3').title).toBe('crash on save')
    expect(BacklogItems.triage('wow!1 no').priority).toBeUndefined()
    expect(BacklogItems.triage('plain item').priority).toBeUndefined()
  })

  it.effect('stores, edits, searches and reverts a priority', () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000)
        const store = yield* openStore()
        const urgent = yield* store.capture({ text: '!1 page on-call', actor: user })
        const later = yield* store.capture({ text: 'tidy docs', actor: user })
        expect(urgent.item.priority).toBe('urgent')
        expect(later.item.priority).toBeUndefined()
        yield* TestClock.adjust(10)
        const edited = yield* store.update({ id: later.item.id, priority: 'low', actor: user })
        expect(edited.ok && edited.value.item.priority).toBe('low')
        expect((yield* store.list({ query: 'priority:urgent' })).items.map(item => item.id)).toEqual([urgent.item.id])
        expect((yield* store.list({ query: '-priority:none' })).items.map(item => item.id).sort()).toEqual([urgent.item.id, later.item.id].sort())
        const at = edited.ok ? (edited.value.item.events.at(-1)?.at ?? 0) : 0
        yield* TestClock.adjust(10)
        const reverted = yield* store.revert({ id: later.item.id, at, field: 'priority', actor: user })
        expect(reverted.ok && reverted.value.item.priority).toBe('none')
      }),
    ),
  )
})

describe('sub-issues', () => {
  it.effect('nests items, rolls their progress up and refuses loops and a fourth level', () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000)
        const store = yield* openStore()
        const epic = yield* store.capture({ text: 'epic', actor: user })
        const child = yield* store.capture({ text: 'child', parent: refOf(epic), actor: user })
        const sibling = yield* store.capture({ text: 'sibling', actor: user })
        yield* store.update({ id: sibling.item.id, parent: refOf(epic), actor: user })
        yield* store.update({ id: sibling.item.id, status: 'done', actor: user })
        const grandchild = yield* store.capture({ text: 'grandchild', parent: refOf(child), actor: user })

        const detail = yield* store.get(epic.item.id)
        expect(detail.ok && detail.value.children.map(entry => entry.id).sort()).toEqual([child.item.id, sibling.item.id].sort())
        const epicRow = (yield* store.list({ query: 'has:children -parent:b:zzzz' })).items.find(item => item.id === epic.item.id)
        expect(epicRow?.children).toEqual({ total: 2, done: 1 })
        expect((yield* store.list({ query: `parent:b:${refOf(epic)}` })).items.map(item => item.id).sort()).toEqual([child.item.id, sibling.item.id].sort())

        const loop = yield* Effect.flip(store.update({ id: epic.item.id, parent: refOf(grandchild), actor: user }))
        expect(loop._tag).toBe('BacklogParentInvalid')
        const self = yield* Effect.flip(store.update({ id: epic.item.id, parent: refOf(epic), actor: user }))
        expect(self.message).toContain('its own parent')
        const deep = yield* Effect.flip(store.capture({ text: 'too deep', parent: refOf(grandchild), actor: user }))
        expect(deep.message).toContain('3 deep at most')

        const detached = yield* store.update({ id: child.item.id, parent: null, actor: user })
        expect(detached.ok && detached.value.item.parent).toBeUndefined()
      }),
    ),
  )
})

describe('ready queue', () => {
  it.effect('serves open, unblocked, childless and unclaimed items, urgent first then oldest', () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000)
        const store = yield* openStore()
        const oldLow = yield* store.capture({ text: '!4 old low', status: 'todo', actor: user })
        yield* TestClock.adjust(10)
        const blocker = yield* store.capture({ text: 'blocker', status: 'todo', actor: user })
        yield* TestClock.adjust(10)
        const waiting = yield* store.capture({ text: '!1 waits on the blocker', status: 'todo', actor: user })
        yield* store.link({ id: waiting.item.id, link: { type: 'item', target: refOf(blocker), relation: 'depends-on' }, actor: user })
        yield* TestClock.adjust(10)
        const blocked = yield* store.capture({ text: '!2 blocked by the blocker', actor: user })
        yield* store.link({ id: blocker.item.id, link: { type: 'item', target: refOf(blocked), relation: 'blocks' }, actor: user })
        yield* TestClock.adjust(10)
        const parent = yield* store.capture({ text: '!1 parent', status: 'todo', actor: user })
        yield* store.capture({ text: 'open child', parent: refOf(parent), status: 'doing', actor: user })
        yield* TestClock.adjust(10)
        const newHigh = yield* store.capture({ text: '!2 new high', actor: user })
        yield* store.capture({ text: 'already doing', status: 'doing', actor: user })

        const ready = (yield* store.list({ ready: true })).items.map(item => item.id)
        expect(ready).toEqual([newHigh.item.id, oldLow.item.id, blocker.item.id])
        expect((yield* store.list({ query: 'is:blocked-by-deps' })).items.map(item => item.id).sort()).toEqual([waiting.item.id, blocked.item.id].sort())

        yield* store.update({ id: blocker.item.id, status: 'done', actor: user })
        const after = (yield* store.list({ query: 'is:ready' })).items.map(item => item.id)
        expect(after).toContain(waiting.item.id)
        expect(after).toContain(blocked.item.id)
      }),
    ),
  )
})

describe('claims', () => {
  it.effect('claims for one thread, refuses another and releases back to the ready queue', () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000)
        const store = yield* openStore()
        const item = yield* store.capture({ text: 'shared work', status: 'todo', actor: user })
        const claimed = yield* store.claim({ id: item.item.id, actor: agentA })
        expect(claimed.ok && claimed.value.item.status).toBe('doing')
        expect(claimed.ok && claimed.value.item.delegate).toBe('agent:session-aaaaaa')
        expect(claimed.ok && claimed.value.lease?.holder).toBe('agent:session-aaaaaa')
        expect(claimed.ok && claimed.value.item.links.some(link => link.type === 'thread' && link.target === 'session-aaaaaa')).toBe(true)
        expect((yield* store.list({ query: 'is:claimed' })).items.map(entry => entry.id)).toEqual([item.item.id])

        const conflict = yield* Effect.flip(store.claim({ id: item.item.id, actor: agentB }))
        expect(conflict._tag).toBe('BacklogItemClaimed')
        expect(conflict.message).toContain('agent:session-aaaaaa')
        const stolen = yield* Effect.flip(store.release({ id: item.item.id, actor: agentB }))
        expect(stolen._tag).toBe('BacklogItemClaimed')
        const byUser = yield* Effect.flip(store.claim({ id: item.item.id, actor: user }))
        expect(byUser._tag).toBe('BacklogClaimRefused')

        const released = yield* store.release({ id: item.item.id, actor: agentA })
        expect(released.ok && released.value.item.status).toBe('todo')
        expect(released.ok && released.value.item.delegate).toBeUndefined()
        expect(released.ok && released.value.lease).toBeNull()
        expect((yield* store.list({ ready: true })).items.map(entry => entry.id)).toEqual([item.item.id])
        const retaken = yield* store.claim({ id: item.item.id, actor: agentB })
        expect(retaken.ok && retaken.value.lease?.holder).toBe('agent:session-bbbbbb')
      }),
    ),
  )

  it.effect('renews on every write by the holder, lapses when idle, ends when the item is done, and survives a restart', () =>
    Effect.scoped(
      Effect.gen(function* () {
        yield* TestClock.setTime(1_000)
        const rows = backlogRows()
        const store = yield* openStore(rows)
        const item = yield* store.capture({ text: 'long work', status: 'todo', actor: user })
        yield* store.claim({ id: item.item.id, actor: agentA })
        yield* TestClock.adjust(20 * MINUTE_MS)
        yield* store.comment({ id: item.item.id, text: 'halfway', actor: agentA })
        const renewed = (yield* store.leases)[0]?.lease
        expect(renewed?.expiresAt).toBe(1_000 + 20 * MINUTE_MS + 30 * MINUTE_MS)

        const reopened = yield* openStore(rows)
        expect((yield* reopened.leases).map(entry => entry.lease.holder)).toEqual(['agent:session-aaaaaa'])

        yield* TestClock.adjust(31 * MINUTE_MS)
        const now = 1_000 + 51 * MINUTE_MS
        expect(LeaseEndings.endings({ leases: yield* store.leases, threads: new Map(), now })).toEqual([
          { id: item.item.id, reason: 'claim by agent:session-aaaaaa lapsed after no write' },
        ])
        const second = yield* store.claim({ id: item.item.id, actor: agentB })
        expect(second.ok && second.value.lease?.holder).toBe('agent:session-bbbbbb')
        const done = yield* store.update({ id: item.item.id, status: 'done', actor: agentB })
        expect(done.ok && done.value.lease).toBeNull()
        expect(done.ok && done.value.item.delegate).toBe('agent:session-bbbbbb')
        expect(yield* store.leases).toEqual([])
      }),
    ),
  )

  it('ends a live claim whose thread is archived, settled or gone', () => {
    const lease = { holder: 'agent:session-aaaaaa', acquiredAt: 0, heartbeat: 0, expiresAt: 10_000 }
    const leases = [{ id: 1, lease }]
    expect(LeaseEndings.endings({ leases, threads: new Map([['session-aaaaaa', 'live']]), now: 5 })).toEqual([])
    expect(LeaseEndings.endings({ leases, threads: new Map([['session-aaaaaa', 'archived']]), now: 5 })).toEqual([
      { id: 1, reason: 'claim by agent:session-aaaaaa ended: its thread is archived' },
    ])
    expect(LeaseEndings.endings({ leases, threads: new Map([['session-aaaaaa', 'gone']]), now: 5 })[0]?.reason).toContain('gone')
  })

  it.effect('sweeps a lapsed claim back to todo and one whose thread is archived, in one bounded span', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          spans => Effect.sync(() => spans[Symbol.dispose]()),
        )
        yield* TestClock.setTime(1_000)
        const store = yield* openStore()
        const idle = yield* store.capture({ text: 'idle claim', status: 'todo', actor: user })
        const archived = yield* store.capture({ text: 'archived thread claim', status: 'todo', actor: user })
        yield* store.claim({ id: idle.item.id, actor: agentA })
        yield* TestClock.adjust(20 * MINUTE_MS)
        yield* store.claim({ id: archived.item.id, actor: agentB })
        yield* TestClock.adjust(11 * MINUTE_MS)
        const lookup = (sessionId: string) => Effect.succeed([sessionId, sessionId === 'session-bbbbbb' ? 'archived' : 'live'] as const)
        const ended = yield* LeaseEndings.sweepOnce({ store, lookup: Option.some(lookup) })
        expect(ended).toBe(2)
        const idleAfter = yield* store.get(idle.item.id)
        expect(idleAfter.ok && idleAfter.value.item.status).toBe('todo')
        expect(idleAfter.ok && idleAfter.value.item.events.at(-1)?.detail).toContain('lapsed after no write')
        const archivedAfter = yield* store.get(archived.item.id)
        expect(archivedAfter.ok && archivedAfter.value.item.events.at(-1)?.detail).toContain('its thread is archived')
        expect(yield* store.leases).toEqual([])
        expect(recorder.span('backlog lease sweep').attributes).toMatchObject({ 'dshx.backlog.leases': 2, 'dshx.backlog.leases_ended': 2 })
      }),
    ).pipe(Effect.provide(DshxEffect.tracerLayer)),
  )
})
