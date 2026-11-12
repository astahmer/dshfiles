import { describe, expect, it } from 'vitest'
import { StackMotionPolicy } from './stack-motion.js'
import { StatusBarStyle } from './phone-shell.js'

describe('StackMotionPolicy', () => {
  it('animates only on touch, with the API, motion allowed and nothing in flight', () => {
    expect(StackMotionPolicy.animates({ supported: true, touch: true, reducedMotion: false, running: false })).toBe(true)
    // Without View Transitions (or with reduced motion) the push is a plain, instant update.
    expect(StackMotionPolicy.animates({ supported: false, touch: true, reducedMotion: false, running: false })).toBe(false)
    expect(StackMotionPolicy.animates({ supported: true, touch: true, reducedMotion: true, running: false })).toBe(false)
    expect(StackMotionPolicy.animates({ supported: true, touch: true, reducedMotion: false, running: true })).toBe(false)
    // A narrow desktop window with a mouse switches instantly.
    expect(StackMotionPolicy.animates({ supported: true, touch: false, reducedMotion: false, running: false })).toBe(false)
  })
})

describe('StatusBarStyle', () => {
  it('lets the dark bg token show through and keeps dark text in light', () => {
    expect(StatusBarStyle.forScheme(true)).toBe('black-translucent')
    expect(StatusBarStyle.forScheme(false)).toBe('default')
  })
})
