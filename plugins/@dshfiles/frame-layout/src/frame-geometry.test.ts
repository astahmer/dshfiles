import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Children, isValidElement } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import { RightbarColumn } from './native/client/AppFrame.js'
import type { MainSurfaceMode, RightPanelMode } from './regions.js'
import { computeColumns } from './native/client/columns.js'
import { createLayoutStore } from './native/client/stores.js'

const geometryCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'native/client/AppFrame.module.css'), 'utf8')
afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })

describe('narrow frame recovery geometry', () => {
  it.each([360, 480, 768])('keeps left and centre reachable after revealing a remembered 420px sidebar at %spx', viewport => {
    expect(computeColumns(viewport, 420, 0)).toEqual({ sidebar: viewport / 2, center: viewport / 2, rightbar: 0 })
  })

  it('concedes the right track before a revealed sidebar can swallow the centre', () => {
    expect(computeColumns(360, 420, 600)).toEqual({ sidebar: 180, center: 180, rightbar: 0 })
    expect(computeColumns(1400, 420, 600)).toEqual({ sidebar: 420, center: 400, rightbar: 580 })
  })

  it('concedes even the collapsed rail only when it would take more than half an extreme viewport', () => {
    expect(computeColumns(80, 0, 0)).toEqual({ sidebar: 40, center: 40, rightbar: 0 })
    expect(computeColumns(360, 0, 0)).toEqual({ sidebar: 56, center: 304, rightbar: 0 })
    expect(computeColumns(80, 0, 0, 0)).toEqual({ sidebar: 0, center: 80, rightbar: 0 })
  })

  it('resolves narrow recovery widths without rewriting the remembered wide preference', () => {
    const instance = createLayoutStore().create()
    instance.actions.setViewportWidth(1400)
    instance.actions.setSidebar(420)
    instance.actions.setViewportWidth(360)
    instance.actions.showSidebar()
    const narrow = instance.getSnapshot().layoutInfo
    expect(narrow.narrowExpanded).toBe(true)
    expect(computeColumns(narrow.viewportWidth, narrow.sidebar, 0)).toEqual({ sidebar: 180, center: 180, rightbar: 0 })
    expect(narrow.sidebar).toBe(420)
    expect(narrow.sidebarLastOpen).toBe(420)
    instance.actions.setViewportWidth(1400)
    const wide = instance.getSnapshot().layoutInfo
    expect(computeColumns(wide.viewportWidth, wide.sidebar, 0)).toEqual({ sidebar: 420, center: 980, rightbar: 0 })
    expect(wide.sidebarLastOpen).toBe(420)
  })
})

/** These assert real CSS placement rules; browser E2E proves pixel geometry. */
describe('frame row geometry', () => {
  function element(className: string, side?: string): HTMLDivElement {
    const node = document.createElement('div')
    node.className = className
    if (side) node.dataset.side = side
    document.body.append(node)
    return node
  }

  it('keeps the right column across both rows and the bottom under left plus centre only', () => {
    const style = document.createElement('style')
    style.textContent = geometryCss
    document.head.append(style)
    expect(getComputedStyle(element('sidebarCol')).gridArea).toBe('1 / 1 / 2 / 2')
    expect(getComputedStyle(element('centerCol')).gridArea).toBe('1 / 2 / 2 / 3')
    expect(getComputedStyle(element('rightbarCol')).gridArea).toBe('1 / 3 / 3 / 4')
    expect(getComputedStyle(element('bottomRow')).gridArea).toBe('2 / 1 / 3 / 3')
  })

  it('bounds the bottom resize handle to its cell and keeps the right handle full-height', () => {
    const style = document.createElement('style')
    style.textContent = geometryCss
    document.head.append(style)
    const bottom = getComputedStyle(element('handle', 'bottom'))
    expect(bottom.gridArea).toBe('2 / 1 / 3 / 3')
    expect(bottom.top).toBe('0px')
    expect(bottom.bottom).toBe('auto')
    expect(getComputedStyle(element('handle', 'rightbar')).gridRow).toBe('1 / -1')
  })
})

describe('native rightbar resource carrier', () => {
  it.each([
    ['workbench', 'dock', true, true],
    ['workbench', 'native', true, true],
    ['native', 'native', false, false],
    ['native', 'dock', true, true],
  ] satisfies [MainSurfaceMode, RightPanelMode, boolean, boolean][])(
    'main=%s right=%s: hidden carrier=%s dock rendered=%s',
    (mainMode, mode, hidden, hasDock) => {
      const called = vi.fn()
      const renderSlot: PropsRenderSlots<'rightbar' | 'shell.dock'>['renderSlot'] = (slot, owner) => {
        called(slot, owner)
        return slot
      }
      const owner = { width: 400, viewportWidth: 1200, canShow: true }
      const column = RightbarColumn({ mainMode, mode, owner, renderSlot })
      const carrier = Children.toArray(column.props.children).find(child =>
        isValidElement(child) && 'data-native-rightbar-carrier' in child.props)
      expect(isValidElement<{ hidden: boolean; style?: CSSProperties; children: ReactNode }>(carrier)).toBe(true)
      if (!isValidElement<{ hidden: boolean; style?: CSSProperties; children: ReactNode }>(carrier)) return
      expect(carrier.props.hidden).toBe(hidden)
      expect(carrier.props.style).toEqual(hidden ? undefined : { display: 'contents' })
      expect(called.mock.calls.some(([slot]) => slot === 'shell.dock')).toBe(hasDock)
      const keepsNative = mainMode === 'workbench' || mode === 'native'
      expect(called.mock.calls.some(([slot]) => slot === 'rightbar')).toBe(keepsNative)
      expect(carrier.props.children).toBe(keepsNative ? 'rightbar' : null)
      const dockCarrier = Children.toArray(column.props.children).find(child =>
        isValidElement(child) && 'data-shell-dock-carrier' in child.props)
      expect(isValidElement<{ hidden: boolean; style?: CSSProperties; children: ReactNode }>(dockCarrier)).toBe(true)
      if (!isValidElement<{ hidden: boolean; style?: CSSProperties; children: ReactNode }>(dockCarrier)) return
      expect(dockCarrier.props.hidden).toBe(mode !== 'dock')
      expect(dockCarrier.props.style).toEqual(mode === 'dock' ? { display: 'contents' } : undefined)
      expect(dockCarrier.props.children).toBe(hasDock ? 'shell.dock' : null)
      for (const [slot, suppliedOwner] of called.mock.calls) {
        if (slot === 'rightbar') expect(suppliedOwner).toBe(owner)
        else expect(suppliedOwner).toEqual({ ...owner, shown: mode === 'dock' })
      }
    },
  )
})
