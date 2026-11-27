import { describe, expect, it } from 'vitest'
import { dockRenderer } from './dock-renderer.js'

describe('dockRenderer', () => {
  it('keeps panels mounted on desktop', () => {
    expect(dockRenderer(false)).toBe('always')
  })

  it('unmounts hidden panels on the phone', () => {
    expect(dockRenderer(true)).toBe('onlyWhenVisible')
  })
})
