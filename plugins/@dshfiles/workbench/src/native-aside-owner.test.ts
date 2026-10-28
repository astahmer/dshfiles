// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NativeAsideOwners } from './registry.js'
import { createNativeAsidePlacement } from './native-aside-placement.js'

const name = 'dshfiles:move-panel-aside'
const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  globalThis.dshfilesWorkbenchNativeAsideOwnersV1 = undefined
})

const listen = (handler: (event: Event) => void): void => {
  window.addEventListener(name, handler)
  disposers.push(() => window.removeEventListener(name, handler))
}
const dispatch = (): boolean => !window.dispatchEvent(new CustomEvent(name, { detail: { panelId: 'panel-a' }, cancelable: true }))

describe('explicit native aside authority', () => {
  it.each(['generic-first', 'specific-first'])('uses the same actual opener exactly once: %s', order => {
    const open = vi.fn(() => true)
    const generic = vi.fn()
    disposers.push(NativeAsideOwners.register('panel-a', open))
    const specific = (event: Event): void => {
      if (!event.defaultPrevented && open()) event.preventDefault()
    }
    const fallback = (event: Event): void => {
      if (event.defaultPrevented) return
      const result = NativeAsideOwners.request('panel-a')
      if (result === 'accepted') event.preventDefault()
      else if (result === 'unowned') generic()
    }
    listen(order === 'generic-first' ? fallback : specific)
    listen(order === 'generic-first' ? specific : fallback)
    expect(dispatch()).toBe(true)
    expect(open).toHaveBeenCalledTimes(1)
    expect(generic).not.toHaveBeenCalled()
  })

  it('does not redirect a declining specific owner into an unrelated generic pane', () => {
    disposers.push(NativeAsideOwners.register('panel-a', () => false))
    expect(NativeAsideOwners.request('panel-a')).toBe('declined')
    expect(NativeAsideOwners.request('unknown')).toBe('unowned')
  })

  it('keeps generic Session placement for unowned panels', () => {
    const show = vi.fn()
    const placement = createNativeAsidePlacement<string>(show)
    disposers.push(() => placement.dispose())
    if (NativeAsideOwners.request('unowned') === 'unowned') placement.request('session-a', 'unowned')
    placement.attach('session-a', 'native-pane')
    expect(show).toHaveBeenCalledExactlyOnceWith('native-pane', 'unowned')
  })

  it('shares callback identity and preserves replacement authority through stale HMR cleanup', () => {
    const old = NativeAsideOwners.register('panel-a', () => false)
    const replacement = vi.fn(() => true)
    const current = NativeAsideOwners.register('panel-a', replacement)
    disposers.push(old, current)
    old()
    expect(NativeAsideOwners.request('panel-a')).toBe('accepted')
    expect(replacement).toHaveBeenCalledTimes(1)
    current()
    expect(NativeAsideOwners.request('panel-a')).toBe('unowned')
  })
})
