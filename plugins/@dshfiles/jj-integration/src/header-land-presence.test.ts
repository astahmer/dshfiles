import { describe, expect, it } from 'vitest'
import { createHeaderLandPresence } from './header-land-presence.js'

describe('header Land presence', () => {
  it('shows a thread while one of its header Lands is marked, and tells subscribers each time', () => {
    const presence = createHeaderLandPresence()
    let calls = 0
    presence.subscribe(() => {
      calls += 1
    })
    expect(presence.shown('session-a')).toBe(false)
    const desktop = presence.mark('session-a')
    const phone = presence.mark('session-a')
    expect(presence.shown('session-a')).toBe(true)
    expect(presence.shown('session-b')).toBe(false)
    desktop()
    desktop()
    expect(presence.shown('session-a')).toBe(true)
    phone()
    expect(presence.shown('session-a')).toBe(false)
    expect(calls).toBe(4)
  })
})
