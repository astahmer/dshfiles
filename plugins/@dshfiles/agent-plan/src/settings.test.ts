import { describe, expect, it } from 'vitest'
import { showsTodoStrip } from './settings.js'

describe('showsTodoStrip', () => {
  it('hides the To-dos strip while the pinned step shows the same plan', () => {
    expect(showsTodoStrip(undefined)).toBe(false)
    expect(showsTodoStrip({ enabled: true, pinnedStep: true, todoStrip: false })).toBe(false)
  })

  it('keeps the strip where no pinned step stands in for it, and when the user asks for both', () => {
    expect(showsTodoStrip({ pinnedStep: false })).toBe(true)
    expect(showsTodoStrip({ enabled: false })).toBe(true)
    expect(showsTodoStrip({ pinnedStep: true, todoStrip: true })).toBe(true)
  })
})
