import { describe, expect, it } from 'vitest'
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

  it('keeps the column geometry the occupant reported when the surface changes', () => {
    const instance = createLayoutStore().create()

    instance.actions.openRightbar(true, false)
    instance.actions.setMode('dock')

    expect(instance.getSnapshot().layoutInfo.rightbarShown).toBe(true)
    expect(instance.getSnapshot().layoutInfo.rightbarTrack).toBe(true)
  })
})
