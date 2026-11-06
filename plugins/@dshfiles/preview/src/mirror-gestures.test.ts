import { describe, expect, it } from 'vitest'
import { MirrorGestures } from './mirror-gestures.js'

describe('MirrorGestures.point', () => {
  it('scales a point on the shrunken frame to the page viewport', () => {
    expect(MirrorGestures.point({ offsetX: 320, offsetY: 100, shownWidth: 640, shownHeight: 400, frameWidth: 1280, frameHeight: 800 })).toEqual({
      x: 640,
      y: 200,
    })
  })

  it('clamps a point on the frame edge inside the viewport', () => {
    expect(MirrorGestures.point({ offsetX: 641, offsetY: -3, shownWidth: 640, shownHeight: 400, frameWidth: 1280, frameHeight: 800 })).toEqual({
      x: 1279,
      y: 0,
    })
  })

  it('maps to the origin while the frame has no size yet', () => {
    expect(MirrorGestures.point({ offsetX: 10, offsetY: 10, shownWidth: 0, shownHeight: 0, frameWidth: 1280, frameHeight: 800 })).toEqual({ x: 0, y: 0 })
  })
})

describe('MirrorGestures.fromKey', () => {
  const press = (key: string, modifiers: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) =>
    MirrorGestures.fromKey({ key, ctrlKey: false, metaKey: false, altKey: false, ...modifiers })

  it('types one printable character as text', () => {
    expect(press('a')).toEqual({ kind: 'text', text: 'a' })
    expect(press(' ')).toEqual({ kind: 'text', text: ' ' })
  })

  it('presses named keys by name', () => {
    expect(press('Enter')).toEqual({ kind: 'key', key: 'Enter' })
    expect(press('ArrowLeft')).toEqual({ kind: 'key', key: 'ArrowLeft' })
  })

  it('leaves shortcuts and lone modifiers to the browser', () => {
    expect(press('c', { metaKey: true })).toBeUndefined()
    expect(press('Shift')).toBeUndefined()
    expect(press('F5')).toBeUndefined()
  })
})
