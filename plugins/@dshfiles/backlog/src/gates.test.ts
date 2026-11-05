import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { DueDates } from './due-date.js'
import { BacklogGates } from './gates.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const openStore = Effect.map(Layer.build(backlogStoreLayer({ rows: backlogRows() })), context => Context.get(context, BacklogStore))
const user = { kind: 'user' } as const
const DAY_MS = 86_400_000
const pull = 'https://github.com/astahmer/dshfiles/pull/42'

describe('gates', () => {
  it('reads GitHub and GitLab pull request URLs', () => {
    expect(BacklogGates.pullRequestOf(`${pull}/files`)).toEqual({ host: 'github', repo: 'astahmer/dshfiles', number: 42, url: pull })
    expect(BacklogGates.pullRequestOf('https://gitlab.com/group/sub/repo/-/merge_requests/7')).toEqual(
      expect.objectContaining({ host: 'gitlab', repo: 'group/sub/repo', number: 7 }),
    )
    expect(BacklogGates.pullRequestOf('https://github.com/astahmer/dshfiles/issues/3')).toBeNull()
  })

  it.effect('keeps a gated item out of the ready queue until every gate is met, and a date gate opens on the calendar', () =>
    Effect.gen(function* () {
      const now = Date.parse('2026-11-05T12:00:00')
      yield* TestClock.setTime(now)
      const store = yield* openStore
      const id = (yield* store.capture({ text: 'ship after the PR', status: 'todo', actor: user })).item.id
      const tomorrow = DueDates.addDays(DueDates.dateOf(now), 1)
      const gated = yield* store.update({
        id,
        gates: [
          { kind: 'pr', target: pull },
          { kind: 'date', target: tomorrow },
        ],
        actor: user,
      })
      if (!gated.ok) throw new Error('expected the item')
      const prGate = gated.value.item.gates?.find(gate => gate.kind === 'pr')
      expect((yield* store.list({ ready: true })).total).toBe(0)
      expect((yield* store.list({ query: 'is:gated' })).items.map(item => item.gates.map(gate => [gate.kind, gate.open]))).toEqual([
        [
          ['pr', true],
          ['date', true],
        ],
      ])

      const resolved = yield* store.resolveGates({ id, resolved: [{ gateId: prGate?.id ?? '', detail: 'merged' }] })
      expect(resolved.ok && resolved.value.item.gates?.find(gate => gate.kind === 'pr')).toEqual(expect.objectContaining({ detail: 'merged', resolvedAt: now }))
      const kept = yield* store.update({ id, gates: [{ kind: 'pr', target: pull }, { kind: 'date', target: tomorrow }], actor: user })
      expect(kept.ok && kept.value.item.gates?.find(gate => gate.kind === 'pr')?.resolvedAt).toBe(now)
      expect((yield* store.list({ ready: true })).total).toBe(0)

      yield* TestClock.adjust(DAY_MS)
      expect((yield* store.list({ ready: true })).items.map(item => item.id)).toEqual([id])
      expect((yield* store.list({ query: 'has:gate -is:gated' })).total).toBe(1)
    }).pipe(Effect.scoped),
  )

  it.effect('closes an item whose fixing pull request merged, but never over a status set by hand', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const store = yield* openStore
      const auto = (yield* store.capture({ text: 'fixed by a PR', actor: user })).item.id
      const manual = (yield* store.capture({ text: 'kept open by hand', status: 'doing', actor: user })).item.id
      const link = { type: 'url', target: pull, relation: 'fixes' } as const
      yield* store.link({ id: auto, link, actor: user })
      yield* store.link({ id: manual, link, actor: user })
      const closed = yield* store.applySignal({ id: auto, status: 'done', link, reason: 'fixed by astahmer/dshfiles#42 merged' })
      const kept = yield* store.applySignal({ id: manual, status: 'done', link, reason: 'fixed by astahmer/dshfiles#42 merged' })
      expect(closed.ok && closed.value.item.status).toBe('done')
      expect(kept.ok && kept.value.item.status).toBe('doing')
    }).pipe(Effect.scoped),
  )
})
