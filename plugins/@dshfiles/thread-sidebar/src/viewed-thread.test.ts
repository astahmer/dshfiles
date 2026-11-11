import { describe, expect, it } from 'vitest'
import { ViewedThreadModel } from './viewed-thread.js'

const watching = { sessionId: 'a', viewedSessionId: 'a', visible: true, focused: true }

describe('ViewedThreadModel.isWatched', () => {
  it('is watched only when the thread is open in a visible, focused window', () => {
    expect(ViewedThreadModel.isWatched(watching)).toBe(true)
  })

  it('still alerts for another thread, a blurred window or a hidden tab', () => {
    expect(ViewedThreadModel.isWatched({ ...watching, viewedSessionId: 'b' })).toBe(false)
    expect(ViewedThreadModel.isWatched({ ...watching, viewedSessionId: undefined })).toBe(false)
    expect(ViewedThreadModel.isWatched({ ...watching, focused: false })).toBe(false)
    expect(ViewedThreadModel.isWatched({ ...watching, visible: false })).toBe(false)
  })
})
