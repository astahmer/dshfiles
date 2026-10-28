import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { HostSnapshotsModel } from './snapshots.js'
import { buildThreadUrl, readThreadUrl } from './thread-url.js'

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

test.each([false, true])('current Session selection and URL follow the exact binding during overlapping retains, reverse=%s', reverse => {
  const a = summary('a', { retainedBy: { mainView: 1 } })
  const b = summary('b', { retainedBy: { mainView: 1 } })
  const selected = HostSnapshotsModel.currentSessionOf(reverse ? [b, a] : [a, b], b.id)
  assert.equal(selected, b)
  assert.ok(selected)
  assert.deepEqual(readThreadUrl(buildThreadUrl('http://localhost:3080/?thread=a', selected.id)), { sessionId: 'b' })
})

test.each([undefined, SessionId('unlisted')])('current Session selection never substitutes a retained row for absent binding %s', currentSessionId => {
  assert.equal(HostSnapshotsModel.currentSessionOf([summary('a', { retainedBy: { mainView: 1 } })], currentSessionId), undefined)
})

test('an equal field set makes two summaries the same', () => {
  assert.equal(HostSnapshotsModel.sameSessionSummary(summary('a'), summary('a')), true)
  assert.equal(HostSnapshotsModel.sameSessionSummary(summary('a'), summary('a', { running: true })), false)
  assert.equal(HostSnapshotsModel.sameSessionSummary(summary('a', { retainedBy: { mainView: 1 } }), summary('a', { retainedBy: { mainView: 1 } })), true)
  assert.equal(HostSnapshotsModel.sameSessionSummary(summary('a', { cwd: '/tmp' }), summary('a', { cwd: '/tmp' })), true)
  assert.equal(HostSnapshotsModel.sameSessionSummary(summary('a', { cwd: '/tmp' }), summary('a', { cwd: '/other' })), false)
})

test('nested JSON values compare by content, not by key order or identity', () => {
  assert.equal(HostSnapshotsModel.sameJsonValue({ mainView: 1, nested: { list: [1, 2, 3] } }, { nested: { list: [1, 2, 3] }, mainView: 1 }), true)
  assert.equal(HostSnapshotsModel.sameJsonValue({ nested: { list: [1, 2] } }, { nested: { list: [1, 3] } }), false)
  assert.equal(HostSnapshotsModel.sameJsonValue(undefined, null), false)
  assert.equal(HostSnapshotsModel.sameJsonValue(null, null), true)
})

test('a projection that changed nothing keeps the previous state object', () => {
  const first = HostSnapshotsModel.stabilizeSessionListState(null, state([summary('a'), summary('b')]))
  const second = HostSnapshotsModel.stabilizeSessionListState(first, state([summary('a'), summary('b')]))
  assert.equal(second, first)
})

test('only the changed row gets a new summary object', () => {
  const first = HostSnapshotsModel.stabilizeSessionListState(null, state([summary('a'), summary('b')]))
  const second = HostSnapshotsModel.stabilizeSessionListState(first, state([summary('a'), summary('b', { updatedAt: 2_000 })]))
  assert.notEqual(second, first)
  assert.equal(row(second, SessionId('a')), row(first, SessionId('a')))
  assert.notEqual(row(second, SessionId('b')), row(first, SessionId('b')))
  assert.equal(second.ids, first.ids)
})

test('a new row keeps the reuse for every untouched row', () => {
  const first = HostSnapshotsModel.stabilizeSessionListState(null, state([summary('a')]))
  const second = HostSnapshotsModel.stabilizeSessionListState(first, state([summary('a'), summary('c')]))
  assert.equal(second.ids.length, 2)
  assert.equal(row(second, SessionId('a')), row(first, SessionId('a')))
  assert.notEqual(second.ids, first.ids)
})

test('a removed row drops the previous record', () => {
  const first = HostSnapshotsModel.stabilizeSessionListState(null, state([summary('a'), summary('b')]))
  const second = HostSnapshotsModel.stabilizeSessionListState(first, state([summary('a')]))
  assert.deepEqual(Object.keys(second.byId), ['a'])
  assert.equal(row(second, SessionId('a')), row(first, SessionId('a')))
})

test('a phase change alone still publishes new state', () => {
  const first = HostSnapshotsModel.stabilizeSessionListState(null, state([summary('a')], 'pending'))
  const second = HostSnapshotsModel.stabilizeSessionListState(first, state([summary('a')], 'ready'))
  assert.notEqual(second, first)
  assert.equal(second.phase, 'ready')
  assert.equal(row(second, SessionId('a')), row(first, SessionId('a')))
})

test('a status change for one session keeps the other rows', () => {
  const status = (running: boolean): { readonly running: boolean; readonly completionUnread: boolean } => ({ running, completionUnread: false })
  const first = HostSnapshotsModel.stabilizeStatusMap(
    null,
    new Map([
      [SessionId('a'), status(false)],
      [SessionId('b'), status(false)],
    ]),
  )
  const second = HostSnapshotsModel.stabilizeStatusMap(
    first,
    new Map([
      [SessionId('a'), status(true)],
      [SessionId('b'), status(false)],
    ]),
  )
  assert.notEqual(second, first)
  assert.notEqual(second.get(SessionId('a')), first.get(SessionId('a')))
  assert.equal(second.get(SessionId('b')), first.get(SessionId('b')))
})

test('an unchanged status map keeps the previous map', () => {
  const status = { running: false, completionUnread: false }
  const first = HostSnapshotsModel.stabilizeStatusMap(null, new Map([[SessionId('a'), status]]))
  const second = HostSnapshotsModel.stabilizeStatusMap(first, new Map([[SessionId('a'), { ...status }]]))
  assert.equal(second, first)
})

test('the status selector keeps the caller value type and its snapshot identity', () => {
  const status = { running: true, completionUnread: false }
  const first = HostSnapshotsModel.selectStableSessionStatus(new Map([[SessionId('a'), status]]))
  const second = HostSnapshotsModel.selectStableSessionStatus(new Map([[SessionId('a'), { ...status }]]))
  assert.equal(first.get(SessionId('a'))?.running, true)
  assert.equal(second, first)
})
