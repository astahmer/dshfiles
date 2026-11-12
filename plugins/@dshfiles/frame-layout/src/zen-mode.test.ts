import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { LayoutController } from './native/client/service.js'
import { createLayoutStore } from './native/client/stores.js'
import { ZenMode } from './zen-mode.js'

const frameCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/client/AppFrame.module.css'), 'utf8')

afterEach(() => {
  localStorage.clear()
  document.head.innerHTML = ''
  document.body.innerHTML = ''
  document.documentElement.removeAttribute(ZenMode.attribute)
})

describe('zen mode seat', () => {
  it('starts off, and reads missing or malformed storage as off', () => {
    expect(ZenMode.create().on()).toBe(false)
    localStorage.setItem(ZenMode.key, '{"on":"yes"}')
    expect(ZenMode.create().on()).toBe(false)
    localStorage.setItem(ZenMode.key, 'not json')
    expect(ZenMode.create().on()).toBe(false)
  })

  it('keeps the choice in this browser, so a reload comes back in zen and leaving survives the next one', () => {
    const seat = ZenMode.create()
    let changes = 0
    seat.subscribe(() => {
      changes += 1
    })
    seat.set(true)
    seat.set(true)
    expect(changes).toBe(1)
    expect(localStorage.getItem(ZenMode.key)).toBe('{"on":true}')
    expect(ZenMode.create().on()).toBe(true)
    seat.set(false)
    expect(ZenMode.create().on()).toBe(false)
  })

  it('mirrors zen onto the root attribute, and removes it on leaving and on teardown', () => {
    const seat = ZenMode.create()
    const root = document.documentElement
    const dispose = ZenMode.reflect(seat, root)
    expect(root.hasAttribute(ZenMode.attribute)).toBe(false)
    seat.set(true)
    expect(root.getAttribute(ZenMode.attribute)).toBe('on')
    seat.set(false)
    expect(root.hasAttribute(ZenMode.attribute)).toBe(false)
    seat.set(true)
    dispose()
    expect(root.hasAttribute(ZenMode.attribute)).toBe(false)
  })

  it('leaves zen on the sidebar toggle instead of toggling, so the sidebar comes back as it was', () => {
    const seat = ZenMode.create()
    const instance = createLayoutStore().create()
    instance.actions.setViewportWidth(1400)
    instance.actions.setSidebar(320)
    const leaveZen = (): boolean => {
      if (!seat.on()) return false
      seat.set(false)
      return true
    }
    const layout = new LayoutController(
      instance.actions,
      () => true,
      { getSnapshot: () => instance.getSnapshot().panelInfo, subscribe: listener => instance.subscribe(listener) },
      undefined,
      leaveZen,
    )
    seat.set(true)
    layout.toggleSidebar()
    expect(seat.on()).toBe(false)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(320)
    layout.toggleSidebar()
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
  })
})

/** Real stylesheet rules; the scratch DSH screenshots prove the pixels. */
describe('zen mode frame rules', () => {
  const frame = (zen: 'columns' | 'compact' | undefined) => {
    const style = document.createElement('style')
    style.textContent = frameCss
    document.head.append(style)
    const root = document.createElement('div')
    root.className = 'frame'
    if (zen !== undefined) root.dataset.zen = zen
    root.innerHTML =
      '<div class="sidebarCol"></div><div class="centerCol"><div data-tab-strip></div><div class="mainSurface"></div></div><div class="rightbarCol"></div><div class="statusStrip"></div>'
    document.body.append(root)
    const pick = (selector: string): HTMLElement => {
      const node = root.querySelector(selector)
      if (!(node instanceof HTMLElement)) throw new Error(`missing ${selector}`)
      return node
    }
    return {
      sidebar: pick('.sidebarCol'),
      tabStrip: pick('[data-tab-strip]'),
      main: pick('.mainSurface'),
      right: pick('.rightbarCol'),
      strip: pick('.statusStrip'),
    }
  }
  const shown = (parts: ReturnType<typeof frame>) =>
    Object.fromEntries(Object.entries(parts).map(([name, node]) => [name, getComputedStyle(node).display !== 'none']))

  it('leaves only the thread surface on a wide frame', () => {
    expect(shown(frame('columns'))).toEqual({ sidebar: false, tabStrip: false, main: true, right: false, strip: false })
  })

  it('keeps a drawer frame’s navigation and right sheet, hiding only the strip and tabs', () => {
    expect(shown(frame('compact'))).toEqual({ sidebar: true, tabStrip: false, main: true, right: true, strip: false })
  })

  it('shows everything outside zen', () => {
    expect(shown(frame(undefined))).toEqual({ sidebar: true, tabStrip: true, main: true, right: true, strip: true })
  })
})
