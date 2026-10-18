import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createFeedHistory, mergeFeedItems } from './feed-history.js'

const item = (id: string, at: number) => ({ id, at })

test('merges the older pages with the newest one, ordering by time and dropping repeated ids', () => {
  const merged = mergeFeedItems({
    older: [item('b', 2), item('a', 1)],
    newest: [item('d', 4), item('c', 3), item('a', 1)],
  })
  assert.deepEqual(
    merged.map(entry => entry.id),
    ['a', 'b', 'c', 'd'],
  )
})

test('keeps the older copy of an id both sides carry, as the accumulated history did', () => {
  const older = item('a', 1)
  const merged = mergeFeedItems({ older: [older], newest: [item('a', 1)] })
  assert.equal(merged[0], older)
})

test('reuses the previous array when a poll changed nothing', () => {
  const older = [item('a', 1)]
  const newest = [item('b', 2)]
  const first = mergeFeedItems({ older, newest })
  const second = mergeFeedItems({ older, newest, previous: first })
  assert.equal(second, first)
})

test('does not reuse a previous array whose items were replaced', () => {
  const older = [item('a', 1)]
  const newest = [item('b', 2)]
  const first = mergeFeedItems({ older, newest })
  assert.equal(mergeFeedItems({ older, newest, previous: first }), first)

  // A poll that replaced an item object must produce a new array, or the changed row would never re-render.
  const replaced = mergeFeedItems({ older, newest: [{ id: 'b', at: 2 }], previous: first })
  assert.notEqual(replaced, first)
  assert.equal(replaced[1]?.id, 'b')
})

test('refuses a page that resolves after the filter changed', () => {
  const history = createFeedHistory()
  const token = history.request()
  assert.equal(history.accepts(token), true)

  history.invalidate()
  assert.equal(history.accepts(token), false)

  const next = history.request()
  assert.notEqual(next, token)
  assert.equal(history.accepts(next), true)
})
