import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { FrameWidthsModel } from './frame-widths.js'
import { SidebarDefaultModel, SIDEBAR_COLLAPSED, SIDEBAR_DEFAULT } from './native/client/columns.js'
import { createLayoutStore } from './native/client/stores.js'

const immediately = (run: () => void): (() => void) => {
  run()
  return () => {}
}

describe('the default sidebar width on a wide window (round five B4, council round 3)', () => {
  beforeEach(() => localStorage.clear())

  it('is 316px (a 256px thread column beside the 60px labelled rail) at 1440px and wider, 280px below', () => {
    expect(SidebarDefaultModel.width(1440)).toBe(316)
    expect(SidebarDefaultModel.width(2560)).toBe(316)
    expect(SidebarDefaultModel.width(1439)).toBe(SIDEBAR_DEFAULT)
    expect(SIDEBAR_DEFAULT).toBe(280)
  })

  it('closes to the 60px labelled rail (round five B3), so the thread column stays 256px', () => {
    expect(SIDEBAR_COLLAPSED).toBe(60)
    expect(SidebarDefaultModel.width(1440) - SIDEBAR_COLLAPSED).toBe(256)
  })

  it('applies only while the user never set a width: a dragged or stored width always wins', () => {
    expect(SidebarDefaultModel.preference({ custom: false, sidebar: SIDEBAR_DEFAULT, viewport: 1440 })).toBe(316)
    expect(SidebarDefaultModel.preference({ custom: true, sidebar: 280, viewport: 1440 })).toBe(280)
    expect(SidebarDefaultModel.preference({ custom: true, sidebar: 360, viewport: 1200 })).toBe(360)
  })

  it('never stores the untouched default, so a later wide window still gets the wide default', () => {
    const instance = createLayoutStore().create()
    FrameWidthsModel.persist({ instance, schedule: immediately })
    instance.actions.setViewportWidth(1500)
    expect(FrameWidthsModel.read()?.sidebar).toBe(0)
    const next = createLayoutStore().create()
    FrameWidthsModel.restore(next)
    expect(next.getSnapshot().layoutInfo.sidebarCustom).toBe(false)
    instance.actions.setSidebar(300)
    expect(FrameWidthsModel.read()?.sidebar).toBe(300)
    const restored = createLayoutStore().create()
    FrameWidthsModel.restore(restored)
    expect(restored.getSnapshot().layoutInfo.sidebarCustom).toBe(true)
    expect(restored.getSnapshot().layoutInfo.sidebar).toBe(300)
  })

  it('is the width the frame lays out when no width was set', () => {
    const frame = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/client/AppFrame.tsx'), 'utf8')
    expect(frame).toMatch(/SidebarDefaultModel\.preference\(\{ custom: layoutInfo\.sidebarCustom, sidebar: layoutInfo\.sidebar, viewport \}\)/u)
  })
})
