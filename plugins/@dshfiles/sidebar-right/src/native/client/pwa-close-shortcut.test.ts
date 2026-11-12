// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { handlePwaCloseShortcut } from './pwa-close-shortcut.js'

describe('PWA close shortcut', () => {
  for (const standalone of [false, true]) {
    it(standalone ? 'handles a PWA close' : 'leaves browser close alone', () => {
      const event = new KeyboardEvent('keydown', { code: 'KeyW', metaKey: true, cancelable: true })
      let calls = 0
      handlePwaCloseShortcut({ event, standalone, mac: true, close: () => { calls += 1; return true } })
      expect(calls).toBe(standalone ? 1 : 0)
      expect(event.defaultPrevented).toBe(standalone)
    })
  }
  it('allows window close when there is no target', () => {
    const event = new KeyboardEvent('keydown', { code: 'KeyW', ctrlKey: true, cancelable: true })
    handlePwaCloseShortcut({ event, standalone: true, mac: false, close: () => false })
    expect(event.defaultPrevented).toBe(false)
  })
})
