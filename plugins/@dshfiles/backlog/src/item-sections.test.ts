import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { BacklogRepo } from './backlog-repo.js'
import { BacklogItems } from './item.js'
import { BacklogStore } from './store.js'
import { backlogRows, backlogStoreLayer } from './test-support.js'

const open = Effect.map(Layer.build(backlogStoreLayer({ rows: backlogRows() })), context => ({
  store: Context.get(context, BacklogStore),
  repo: Context.get(context, BacklogRepo),
}))

const user = { kind: 'user' } as const
const agent = { kind: 'agent', sessionId: 'session-abc123', cwd: '/work/dshfiles' } as const

const detailOf = <A>(result: { readonly ok: true; readonly value: A } | { readonly ok: false }): A => {
  if (!result.ok) throw new Error('expected the item')
  return result.value
}

describe('item sections', () => {
  it.effect('checks criteria off one by one, rolls them up, and keeps their ids when the list is rewritten', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const { store, repo } = yield* open
      const created = yield* store.capture({ text: 'ship sections', actor: user })
      const id = created.item.id
      const listed = detailOf(yield* store.update({ id, criteria: [{ text: 'criteria stored' }, { text: 'plan stored' }], actor: agent })).item.criteria ?? []
      expect(listed.map(criterion => criterion.text)).toEqual(['criteria stored', 'plan stored'])

      yield* store.update({ id, criteriaChecks: [{ id: listed[0]?.id ?? '', done: true }], actor: agent })
      const rewritten = detailOf(yield* store.update({ id, criteria: [{ text: 'plan stored' }, { text: 'criteria stored' }, { text: 'summary stored' }], actor: user }))
      expect(rewritten.item.criteria?.map(criterion => [criterion.text, criterion.done])).toEqual([
        ['plan stored', false],
        ['criteria stored', true],
        ['summary stored', false],
      ])
      expect(rewritten.item.criteria?.find(criterion => criterion.text === 'criteria stored')?.id).toBe(listed[0]?.id)
      expect((yield* store.list({ query: 'has:criteria' })).items[0]?.criteriaProgress).toEqual({ total: 3, done: 1 })
      expect(rewritten.item.humanFields).toContain('criteria')

      const cleared = detailOf(yield* store.update({ id, criteria: null, actor: user }))
      expect(cleared.item.criteria).toBeUndefined()
      expect((yield* store.list({ query: 'has:criteria' })).total).toBe(0)
      const folded = (yield* repo.foldAll).find(item => item.id === id)
      expect(folded !== undefined && 'criteria' in folded).toBe(false)
      expect(folded?.events.length).toBe(cleared.item.events.length)
    }).pipe(Effect.scoped),
  )

  it.effect('asks for input while a plan waits for approval, and only the user approves it', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const { store } = yield* open
      const id = (yield* store.capture({ text: 'needs a plan', actor: user })).item.id

      const asked = detailOf(yield* store.update({ id, plan: '1. read\n2. write', planApproval: 'pending', actor: agent }))
      expect(asked.item).toEqual(expect.objectContaining({ plan: '1. read\n2. write', planApproval: 'pending', attention: 'needs-input' }))
      expect((yield* store.list({ query: 'is:plan-pending' })).total).toBe(1)
      expect((yield* store.list({ inbox: true })).total).toBe(1)

      const selfApproved = detailOf(yield* store.update({ id, planApproval: 'approved', actor: agent }))
      expect(selfApproved.item.planApproval).toBe('pending')

      const approved = detailOf(yield* store.update({ id, planApproval: 'approved', actor: user }))
      expect(approved.item).toEqual(expect.objectContaining({ planApproval: 'approved', attention: 'none' }))
      expect((yield* store.list({ query: 'is:plan-pending' })).total).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.effect('keeps a final summary, finds it by text and reverts it from the log', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(1_000)
      const { store } = yield* open
      const id = (yield* store.capture({ text: 'close with a summary', actor: user })).item.id
      yield* TestClock.adjust(10)
      const closed = detailOf(yield* store.update({ id, status: 'done', summary: 'Landed the sections revision.', actor: agent }))
      expect(closed.item.summary).toBe('Landed the sections revision.')
      expect((yield* store.list({ query: 'sections revision', freshness: 'all' })).total).toBe(1)

      const event = closed.item.events.find(candidate => candidate.fieldChanges?.some(change => change.field === 'summary'))
      const reverted = yield* store.revert({ id, at: event?.at ?? 0, field: 'summary', actor: user })
      expect(reverted.ok && reverted.value.item.summary).toBeUndefined()
    }).pipe(Effect.scoped),
  )

  it('reads criteria from checklist lines', () => {
    expect(BacklogItems.criteriaFromText('- [x] one\n- [ ] two\nthree\n\n').map(criterion => [criterion.text, criterion.done])).toEqual([
      ['one', true],
      ['two', false],
      ['three', false],
    ])
  })
})
