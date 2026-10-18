import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { SessionListCacheModel } from './session-list-cache.js'

const summary = (id: string, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: SessionId(id),
  displayTitle: id,
  running: false,
  retainedBy: {},
  blank: false,
  updatedAt: 1_000,
  ...overrides,
})

const row = (value: SessionListState, id: SessionId): SessionSummary | undefined => value.byId[id]

const state = (summaries: readonly SessionSummary[], phase: SessionListState['phase'] = 'ready'): SessionListState => ({
  ids: summaries.map(item => item.id),
  byId: Object.fromEntries(summaries.map(item => [item.id, item])),
  phase,
  projectionsBySession: {},
})

test('an equal field set makes two summaries the same', () => {
  assert.equal(SessionListCacheModel.sameSessionSummary(summary('a'), summary('a')), true)
  assert.equal(SessionListCacheModel.sameSessionSummary(summary('a'), summary('a', { running: true })), false)
  assert.equal(SessionListCacheModel.sameSessionSummary(summary('a', { retainedBy: { mainView: 1 } }), summary('a', { retainedBy: { mainView: 1 } })), true)
  assert.equal(
    SessionListCacheModel.sameSessionSummary(summary('a', { projectionValues: { title: 'x' } }), summary('a', { projectionValues: { title: 'x' } })),
    true,
  )
})

test('a projection that changed nothing keeps the previous state object', () => {
  const first = SessionListCacheModel.stabilizeSessionListState(null, state([summary('a'), summary('b')]))
  const second = SessionListCacheModel.stabilizeSessionListState(first, state([summary('a'), summary('b')]))
  assert.equal(second, first)
})

test('only the changed row gets a new summary object', () => {
  const first = SessionListCacheModel.stabilizeSessionListState(null, state([summary('a'), summary('b')]))
  const second = SessionListCacheModel.stabilizeSessionListState(first, state([summary('a'), summary('b', { updatedAt: 2_000 })]))
  assert.notEqual(second, first)
  assert.equal(row(second, SessionId('a')), row(first, SessionId('a')))
  assert.notEqual(row(second, SessionId('b')), row(first, SessionId('b')))
  assert.equal(second.ids, first.ids)
})

test('a new row keeps the reuse for every untouched row', () => {
  const first = SessionListCacheModel.stabilizeSessionListState(null, state([summary('a')]))
  const second = SessionListCacheModel.stabilizeSessionListState(first, state([summary('a'), summary('c')]))
  assert.equal(second.ids.length, 2)
  assert.equal(row(second, SessionId('a')), row(first, SessionId('a')))
  assert.notEqual(second.ids, first.ids)
})

test('a removed row drops the previous record', () => {
  const first = SessionListCacheModel.stabilizeSessionListState(null, state([summary('a'), summary('b')]))
  const second = SessionListCacheModel.stabilizeSessionListState(first, state([summary('a')]))
  assert.deepEqual(Object.keys(second.byId), ['a'])
  assert.equal(row(second, SessionId('a')), row(first, SessionId('a')))
})

test('a phase change alone still publishes new state', () => {
  const first = SessionListCacheModel.stabilizeSessionListState(null, state([summary('a')], 'pending'))
  const second = SessionListCacheModel.stabilizeSessionListState(first, state([summary('a')], 'ready'))
  assert.notEqual(second, first)
  assert.equal(second.phase, 'ready')
  assert.equal(row(second, SessionId('a')), row(first, SessionId('a')))
})
