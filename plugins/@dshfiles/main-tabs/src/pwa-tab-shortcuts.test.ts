import { describe, expect, it } from 'vitest'
import { handlePwaTabShortcut } from './pwa-tab-shortcuts.js'

describe('PWA tab shortcuts', () => {
  for (const standalone of [false, true]) {
    for (const shift of [false, true]) {
      it(`${standalone ? 'PWA' : 'browser'} ${shift ? 'reopen' : 'new'}`, () => {
        const event = new KeyboardEvent('keydown', { code: 'KeyT', metaKey: true, shiftKey: shift, cancelable: true })
        const actions: string[] = []
        handlePwaTabShortcut({
          event,
          standalone,
          mac: true,
          run: action => {
            actions.push(action)
            return true
          },
        })
        expect(actions).toEqual(standalone ? [shift ? 'reopen' : 'new'] : [])
        expect(event.defaultPrevented).toBe(standalone)
      })
    }
  }
  for (const standalone of [false, true]) {
    it(`close in ${standalone ? 'PWA' : 'browser'}`, () => {
      const event = new KeyboardEvent('keydown', { code: 'KeyW', metaKey: true, cancelable: true })
      const actions: string[] = []
      handlePwaTabShortcut({
        event,
        standalone,
        mac: true,
        run: action => {
          actions.push(action)
          return true
        },
      })
      expect(actions).toEqual(standalone ? ['close'] : [])
      expect(event.defaultPrevented).toBe(standalone)
    })
  }
  it('does not consume an unavailable command', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyT', ctrlKey: true, shiftKey: true, cancelable: true })
    handlePwaTabShortcut({ event, standalone: true, mac: false, run: () => false })
    expect(event.defaultPrevented).toBe(false)
  })
})
