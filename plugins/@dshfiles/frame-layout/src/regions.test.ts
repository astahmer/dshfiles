import { describe, expect, it } from 'vitest'
import { BOTTOM_DEFAULT, BOTTOM_MAX_RATIO, BOTTOM_MIN } from './native/client/columns.js'
import { createLayoutStore } from './native/client/stores.js'

/**
 * The right column's seat (frame local delta): which surface fills it is a
 * reported fact, so a dock plugin can hand the column over and take it back
 * without the frame knowing anything about the dock itself.
 */
describe('right panel seat', () => {
  it('starts on the native surface and follows the reported mode', () => {
    const instance = createLayoutStore().create()

    expect(instance.getSnapshot().layoutInfo.rightPanelMode).toBe('native')

    instance.actions.setMode('dock')
    expect(instance.getSnapshot().layoutInfo.rightPanelMode).toBe('dock')

    instance.actions.setMode('native')
    expect(instance.getSnapshot().layoutInfo.rightPanelMode).toBe('native')
  })

  it('opens, resizes and reopens the bottom row at the height the user dragged', () => {
    const instance = createLayoutStore().create()

    expect(instance.getSnapshot().layoutInfo.bottomShown).toBe(false)

    instance.actions.openBottom()
    expect(instance.getSnapshot().layoutInfo.bottomShown).toBe(true)
    expect(instance.getSnapshot().layoutInfo.bottom).toBe(BOTTOM_DEFAULT)

    instance.actions.setBottom(320)
    instance.actions.closeBottom()
    expect(instance.getSnapshot().layoutInfo.bottomShown).toBe(false)

    instance.actions.openBottom()
    expect(instance.getSnapshot().layoutInfo.bottom).toBe(320)
  })

  it('clamps the bottom row so it can never swallow the frame', () => {
    const instance = createLayoutStore().create()

    instance.actions.setBottom(99_999)
    expect(instance.getSnapshot().layoutInfo.bottom).toBe(Math.round(window.innerHeight * BOTTOM_MAX_RATIO))

    instance.actions.setBottom(1)
    expect(instance.getSnapshot().layoutInfo.bottom).toBe(BOTTOM_MIN)
  })

  it('keeps the column geometry the occupant reported when the surface changes', () => {
    const instance = createLayoutStore().create()

    instance.actions.openRightbar(true, false)
    instance.actions.setMode('dock')

    expect(instance.getSnapshot().layoutInfo.rightbarShown).toBe(true)
    expect(instance.getSnapshot().layoutInfo.rightbarTrack).toBe(true)
  })
})
