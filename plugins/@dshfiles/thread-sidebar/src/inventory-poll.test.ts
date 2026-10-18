import assert from 'node:assert/strict'
import { test } from 'vitest'
import { createInventoryPoll } from './inventory-poll.js'

/** A manual clock: the test decides when a scheduled refresh fires. */
const clock = () => {
  let nextHandle = 1
  const pending = new Map<number, { readonly callback: () => void; readonly delayMs: number }>()
  return {
    schedule: (callback: () => void, delayMs: number): number => {
      nextHandle += 1
      pending.set(nextHandle, { callback, delayMs })
      return nextHandle
    },
    cancel: (handle: number): void => {
      pending.delete(handle)
    },
    pending: () => pending.size,
    /** Fire the single pending refresh, as the timer would. */
    fire: (): void => {
      const [handle, entry] = [...pending.entries()][0] ?? []
      assert.ok(handle !== undefined && entry !== undefined, 'no scheduled refresh to fire')
      pending.delete(handle)
      entry.callback()
    },
  }
}

const poll = (options: { readonly intervalMs?: number } = {}) => {
  const timer = clock()
  const refreshes: number[] = []
  let hidden = false
  const subject = createInventoryPoll({
    refresh: () => refreshes.push(refreshes.length + 1),
    intervalMs: options.intervalMs ?? 30_000,
    isHidden: () => hidden,
    schedule: timer.schedule,
    cancel: timer.cancel,
  })
  return { subject, timer, refreshes, hide: () => (hidden = true), show: () => (hidden = false) }
}

test('refreshes on its own schedule while the page is visible', () => {
  const { subject, timer, refreshes } = poll()
  subject.start()
  assert.equal(timer.pending(), 1)
  timer.fire()
  assert.deepEqual(refreshes, [1])
  assert.equal(timer.pending(), 1)
  timer.fire()
  assert.deepEqual(refreshes, [1, 2])
})

test('waits while the tab is hidden and catches up once on return', () => {
  const { subject, timer, refreshes, hide, show } = poll()
  hide()
  subject.start()
  assert.equal(timer.pending(), 0)

  show()
  subject.visibilityChanged()
  assert.deepEqual(refreshes, [1])
  assert.equal(timer.pending(), 1)

  hide()
  subject.visibilityChanged()
  assert.equal(timer.pending(), 0)
  assert.deepEqual(refreshes, [1])
})

test('a missing owner stops the timer and its return re-arms it', () => {
  const { subject, timer, refreshes } = poll()
  subject.start()
  subject.setAvailable(false)
  assert.equal(timer.pending(), 0)

  subject.setAvailable(true)
  assert.equal(timer.pending(), 1)
  timer.fire()
  assert.deepEqual(refreshes, [1])
})

test('stop cancels the pending refresh for good', () => {
  const { subject, timer, refreshes } = poll()
  subject.start()
  subject.stop()
  assert.equal(timer.pending(), 0)
  subject.visibilityChanged()
  assert.deepEqual(refreshes, [])
})

test('a visibility event while the page stayed visible changes nothing', () => {
  const { subject, timer, refreshes } = poll()
  subject.start()
  subject.visibilityChanged()
  assert.equal(timer.pending(), 1)
  assert.deepEqual(refreshes, [])

  timer.fire()
  assert.deepEqual(refreshes, [1])
  subject.visibilityChanged()
  assert.equal(timer.pending(), 1)
  assert.deepEqual(refreshes, [1])
})

test('a schedule stopped for a hidden surface stays quiet through a visibility cycle', () => {
  const { subject, timer, refreshes, hide, show } = poll()
  subject.start()
  subject.setAvailable(false)
  assert.equal(timer.pending(), 0)

  hide()
  subject.visibilityChanged()
  show()
  subject.visibilityChanged()
  assert.deepEqual(refreshes, [])
  assert.equal(timer.pending(), 0)

  subject.setAvailable(true)
  assert.equal(timer.pending(), 1)
})
