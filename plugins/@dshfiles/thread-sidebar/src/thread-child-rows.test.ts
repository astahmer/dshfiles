import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { createThreadChildRowCache, NO_CHILD_THREADS } from './thread-child-rows.js'

const child = (id: string, overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: SessionId(id),
  displayTitle: id,
  running: false,
  retainedBy: {},
  blank: false,
  updatedAt: 1_000,
  origin: 'subagent',
  ...overrides,
})

const empty = { groupedAttentionIds: new Set<string>(), waitingSessionIds: new Set<string>() }

test('a parent without children shares the empty row', () => {
  const cache = createThreadChildRowCache()
  const first = cache.resolve({ ...empty, children: NO_CHILD_THREADS, listChildren: true, groupByStatus: true, mode: 'collapse', selectedSessionId: undefined })
  const second = cache.resolve({ ...empty, children: NO_CHILD_THREADS, listChildren: true, groupByStatus: true, mode: 'show', selectedSessionId: undefined })
  assert.equal(first.live, NO_CHILD_THREADS)
  assert.equal(first.listed, NO_CHILD_THREADS)
  assert.equal(second, first)
})

test('an unchanged parent keeps the arrays its row already rendered', () => {
  const cache = createThreadChildRowCache()
  const children = [child('done'), child('live', { running: true })]
  const inputs = { ...empty, children, listChildren: true, groupByStatus: true, mode: 'collapse' as const, selectedSessionId: undefined }
  const first = cache.resolve(inputs)
  assert.deepEqual(
    first.live.map(item => item.id),
    ['live'],
  )
  assert.deepEqual(
    first.finished.map(item => item.id),
    ['done'],
  )
  assert.equal(cache.resolve(inputs), first)
})

test('a changed child list and a new selection both invalidate the row', () => {
  const cache = createThreadChildRowCache()
  const children = [child('done')]
  const inputs = { ...empty, children, listChildren: true, groupByStatus: true, mode: 'hide' as const, selectedSessionId: undefined }
  const first = cache.resolve(inputs)
  // The children array is the cache key: the tree only rebuilds it when that parent's children moved.
  assert.notEqual(cache.resolve({ ...inputs, children: [...children] }), first)
  const moved = cache.resolve({ ...inputs, children: [child('done', { running: true })] })
  assert.notEqual(moved, first)
  assert.deepEqual(
    moved.live.map(item => item.id),
    ['done'],
  )
  const selected = cache.resolve({ ...inputs, selectedSessionId: SessionId('done') })
  assert.equal(selected.selectedChildId, 'done')
  assert.deepEqual(
    selected.live.map(item => item.id),
    ['done'],
  )
})

test('the main source filter lists no children', () => {
  const cache = createThreadChildRowCache()
  const row = cache.resolve({
    ...empty,
    children: [child('done')],
    listChildren: false,
    groupByStatus: false,
    mode: 'show',
    selectedSessionId: undefined,
  })
  assert.equal(row.live, NO_CHILD_THREADS)
  assert.equal(row.finished, NO_CHILD_THREADS)
})
