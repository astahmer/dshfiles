import { beforeEach, describe, expect, it } from 'vitest'
import { FRAME_WIDTHS_KEY, FrameWidthsModel } from './frame-widths.js'
import { RIGHTBAR_MIN, SIDEBAR_DEFAULT, SIDEBAR_MAX } from './native/client/columns.js'
import { createLayoutStore } from './native/client/stores.js'

const openStore = () => createLayoutStore().create()

/** Stored shape before validation: the collapse flag is absent in records written before it existed. */
type SeededFrameWidths = { sidebar: number; rightbar: number | null; collapsed?: boolean }

const seed = (widths: SeededFrameWidths): void => localStorage.setItem(FRAME_WIDTHS_KEY, JSON.stringify(widths))

describe('frame width persistence', () => {
  beforeEach(() => localStorage.clear())

  it('keeps the contract defaults when the browser stored nothing', () => {
    const instance = openStore()
    FrameWidthsModel.restore(instance)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(SIDEBAR_DEFAULT)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBeNull()
  })

  it('reopens the sidebar at its last dragged width and keeps the right panel width', () => {
    seed({ sidebar: 380, rightbar: 520, collapsed: false })
    const instance = openStore()
    FrameWidthsModel.restore(instance)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(380)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(520)
  })

  it('clamps stored widths into the drag range instead of trusting them', () => {
    seed({ sidebar: 9000, rightbar: 10, collapsed: false })
    const instance = openStore()
    FrameWidthsModel.restore(instance)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(SIDEBAR_MAX)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(RIGHTBAR_MIN)
  })

  it('ignores malformed stored geometry', () => {
    localStorage.setItem(FRAME_WIDTHS_KEY, '{"sidebar":"wide"}')
    expect(FrameWidthsModel.read()).toBeNull()
    const instance = openStore()
    FrameWidthsModel.restore(instance)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(SIDEBAR_DEFAULT)
  })

  it('writes a dragged width back for the next page load', () => {
    const instance = openStore()
    FrameWidthsModel.persist(instance)
    instance.actions.setSidebar(360)
    instance.actions.setRightbar(480)
    expect(FrameWidthsModel.read()).toEqual({ sidebar: 360, rightbar: 480, collapsed: false })
  })

  it('boots collapsed when the last wide state was collapsed, and reopens at the remembered width', () => {
    seed({ sidebar: 384, rightbar: 420, collapsed: true })
    const instance = openStore()
    FrameWidthsModel.restore(instance)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
    expect(instance.getSnapshot().layoutInfo.rightbar).toBe(420)
    instance.actions.toggleSidebar()
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(384)
  })

  it('writes the collapsed state back and remembers the open width across it', () => {
    const instance = openStore()
    FrameWidthsModel.persist(instance)
    instance.actions.setSidebar(360)
    instance.actions.toggleSidebar()
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(0)
    expect(FrameWidthsModel.read()).toEqual({ sidebar: 360, rightbar: null, collapsed: true })
    const reloaded = openStore()
    FrameWidthsModel.restore(reloaded)
    expect(reloaded.getSnapshot().layoutInfo.sidebar).toBe(0)
    reloaded.actions.toggleSidebar()
    expect(reloaded.getSnapshot().layoutInfo.sidebar).toBe(360)
  })

  it('accepts a record written before the collapsed flag and boots open', () => {
    seed({ sidebar: 300, rightbar: null })
    expect(FrameWidthsModel.read()?.collapsed).toBe(false)
    const instance = openStore()
    FrameWidthsModel.restore(instance)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(300)
  })

  it("leaves a narrow frame's auto-collapse to the frame", () => {
    seed({ sidebar: 340, rightbar: null, collapsed: true })
    const instance = openStore()
    instance.actions.setViewportWidth(900)
    FrameWidthsModel.restore(instance)
    expect(instance.getSnapshot().layoutInfo.sidebar).toBe(340)
    expect(instance.getSnapshot().layoutInfo.narrowExpanded).toBe(false)
  })
})
