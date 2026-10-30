import { describe, expect, it } from 'vitest'

import { BacklogFocusModel } from './backlog-focus.js'

describe('backlog focus', () => {
  it('keeps palette capture text until the composer receives it', () => {
    const seen: (string | null)[] = []
    const stop = BacklogFocusModel.subscribe(() => {
      seen.push(BacklogFocusModel.readCapture()?.text ?? null)
    })

    BacklogFocusModel.requestCapture('bug: screenshot')
    const request = BacklogFocusModel.readCapture()
    expect(request?.text).toBe('bug: screenshot')
    expect(request?.id).toBeTypeOf('number')

    BacklogFocusModel.clearCapture()
    expect(BacklogFocusModel.readCapture()).toBeNull()
    expect(seen).toEqual(['bug: screenshot', null])
    stop()
  })

  it('lets only one mounted panel take each capture and preserves newer requests', () => {
    BacklogFocusModel.requestCapture('first')
    const first = BacklogFocusModel.readCapture()
    if (first === null) throw new Error('Missing capture')
    expect(BacklogFocusModel.takeCapture(first.id)).toEqual(first)
    expect(BacklogFocusModel.takeCapture(first.id)).toBeNull()
    BacklogFocusModel.requestCapture('second')
    expect(BacklogFocusModel.takeCapture(first.id)).toBeNull()
    expect(BacklogFocusModel.readCapture()?.text).toBe('second')
    BacklogFocusModel.clearCapture()
  })

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
