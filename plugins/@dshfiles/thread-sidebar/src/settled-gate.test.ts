import assert from 'node:assert/strict'
import { test } from 'vitest'
import { underSettledSession, type SettledSessionHeader } from './settled-gate.js'

const walk = (input: {
  readonly header: SettledSessionHeader
  readonly settled?: readonly string[]
  readonly parents?: Readonly<Record<string, SettledSessionHeader>>
}): boolean =>
  underSettledSession({
    header: input.header,
    settledSessionIds: input.settled ?? [],
    parentHeader: sessionId => input.parents?.[sessionId],
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
