import { describe, expect, it } from 'vitest'
import { createThreadMultiSelectionStore } from './thread-multi-selection.js'

describe('thread multi-selection store', () => {
  it('answers membership and notifies only when the selected set changes', () => {
    const store = createThreadMultiSelectionStore()
    let notified = 0
    const unsubscribe = store.subscribe(() => {
      notified += 1
    })

    store.set(['a', 'c'])
    expect(['a', 'b', 'c'].map(store.has)).toEqual([true, false, true])
    store.set(['c', 'a'])
    expect(notified).toBe(1)

    store.set(['b'])
    expect(['a', 'b', 'c'].map(store.has)).toEqual([false, true, false])
    expect(notified).toBe(2)

    unsubscribe()
    store.set([])
    expect(notified).toBe(2)
    expect(store.has('b')).toBe(false)
  })
})
