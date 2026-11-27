import assert from 'node:assert/strict'
import { test } from 'vitest'
import { SettledGateModel, type SettledSessionHeader } from './settled-gate.js'

const walk = (input: {
  readonly header: SettledSessionHeader
  readonly settled?: readonly string[]
  readonly parents?: Readonly<Record<string, SettledSessionHeader>>
}): boolean =>
  SettledGateModel.under({
    header: input.header,
    settledSessionIds: input.settled ?? [],
    parentHeader: sessionId => input.parents?.[sessionId],
  })

test('names every settled owner up the lineage, nearest first, so a reminder can lift each one', () => {
  const header: SettledSessionHeader = { id: 'child', origin: 'subagent', parentSession: 'parent' }
  const parents = {
    parent: { id: 'parent', origin: 'subagent', parentSession: 'grandparent' },
    grandparent: { id: 'grandparent' },
  } satisfies Record<string, SettledSessionHeader>
  const parentHeader = (sessionId: string) => (sessionId === 'parent' ? parents.parent : sessionId === 'grandparent' ? parents.grandparent : undefined)
  assert.deepEqual(SettledGateModel.lineage({ header, settledSessionIds: ['parent', 'grandparent'], parentHeader }), ['parent', 'grandparent'])
  assert.deepEqual(
    SettledGateModel.lineage({
      header: { id: 'child', origin: 'subagent', parentSession: 'gone' },
      settledSessionIds: ['gone'],
      parentHeader: () => undefined,
    }),
    ['gone'],
  )
  assert.deepEqual(SettledGateModel.lineage({ header: { id: 'free' }, settledSessionIds: ['elsewhere'], parentHeader: () => undefined }), [])
})

test('a settled session owns its own step', () => {
  assert.equal(walk({ header: { id: 'a' }, settled: ['a'] }), true)
  assert.equal(walk({ header: { id: 'a' }, settled: ['other'] }), false)
})

test('a subagent child of a settled session is covered through its recorded parent id', () => {
  assert.equal(walk({ header: { id: 'child', origin: 'subagent', parentSession: 'parent' }, settled: ['parent'] }), true)
  assert.equal(
    walk({
      header: { id: 'grandchild', origin: 'subagent', parentSession: 'child' },
      settled: ['parent'],
      parents: { child: { id: 'child', origin: 'subagent', parentSession: 'parent' } },
    }),
    true,
  )
})

test('a fork of a settled session stays independent, and unrelated sessions are untouched', () => {
  assert.equal(walk({ header: { id: 'fork', parentSession: 'parent' }, settled: ['parent'] }), false)
  assert.equal(walk({ header: { id: 'child', origin: 'subagent', parentSession: 'parent' }, settled: ['elsewhere'] }), false)
})

test('a corrupt cycle still terminates', () => {
  assert.equal(
    walk({
      header: { id: 'a', origin: 'subagent', parentSession: 'b' },
      parents: {
        b: { id: 'b', origin: 'subagent', parentSession: 'a' },
      },
    }),
    false,
  )
})

test('a reminder step runs and lifts the settled owners, every other wake waits for an unsettle', () => {
  const reminder = { source: { kind: 'schedule' } }
  const answer = { source: { kind: 'user' } }
  assert.equal(SettledGateModel.stepFor({ settledOwners: [], messages: [answer] }), 'run')
  assert.equal(SettledGateModel.stepFor({ settledOwners: ['parent'], messages: [answer] }), 'reject')
  assert.equal(SettledGateModel.stepFor({ settledOwners: ['parent'], messages: [answer, reminder] }), 'run')
})
