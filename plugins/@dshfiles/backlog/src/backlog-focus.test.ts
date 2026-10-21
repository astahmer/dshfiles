import { describe, expect, it } from 'vitest'

import { BacklogFocusModel } from './backlog-focus.js'

describe('backlog focus', () => {
  it('keeps the item a reference asked for until the panel takes it', () => {
    const seen: (number | null)[] = []
    const stop = BacklogFocusModel.subscribe(() => {
      seen.push(BacklogFocusModel.read())
    })

    BacklogFocusModel.request(12)
    expect(BacklogFocusModel.read()).toBe(12)

    BacklogFocusModel.clear()
    expect(BacklogFocusModel.read()).toBeNull()
    expect(seen).toEqual([12, null])
    stop()

    BacklogFocusModel.request(7)
    expect(seen).toEqual([12, null])
    BacklogFocusModel.clear()
  })
})
