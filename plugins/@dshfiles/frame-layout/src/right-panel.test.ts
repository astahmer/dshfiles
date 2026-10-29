import { describe, expect, it, vi } from 'vitest'
import type { DockPaneActions } from './regions.js'
import { createRightPanelSeat } from './right-panel.js'
import { createLayoutStore } from './native/client/stores.js'

function dockActions(): DockPaneActions {
  let open = false
  const listeners = new Set<() => void>()
  const setOpen = (next: boolean): void => {
    if (open === next) return
    open = next
    for (const listener of listeners) listener()
  }
  return {
    isOpen: () => open,
    open: () => setOpen(true),
    close: () => setOpen(false),
    toggle: () => setOpen(!open),
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

describe('frame-lifetime right dock port', () => {
  it('exposes the actual actions while hidden without changing compatibility ownership', () => {
    const instance = createLayoutStore().create()
    const seat = createRightPanelSeat(instance)
    expect(seat.dock?.()).toBeUndefined()
    const actions = dockActions()
    const unregister = seat.registerDock(actions)
    expect(seat.mode()).toBe('native')
    expect(seat.dock?.()).toBe(actions)
    const changed = vi.fn()
    const unsubscribe = actions.subscribe(changed)
    actions.toggle()
    expect(actions.isOpen()).toBe(true)
    actions.close()
    actions.open()
    expect(changed).toHaveBeenCalledTimes(3)
    unsubscribe()
    actions.close()
    expect(changed).toHaveBeenCalledTimes(3)
    unregister()
    expect(seat.dock?.()).toBeUndefined()
  })

  it('keeps overlapping registrations independently disposable, including identical actions', () => {
    const seat = createRightPanelSeat(createLayoutStore().create())
    const first = dockActions()
    const second = dockActions()
    const offFirst = seat.registerDock(first)
    const offSecond = seat.registerDock(second)
    const offSame = seat.registerDock(second)
    offSecond()
    expect(seat.dock?.()).toBe(second)
    offSame()
    expect(seat.dock?.()).toBe(first)
    offFirst()
    offFirst()
    expect(seat.dock?.()).toBeUndefined()
  })

  it('clears the registry on frame teardown and cannot leak into a fresh frame', () => {
    const instance = createLayoutStore().create()
    const seat = createRightPanelSeat(instance)
    const off = seat.registerDock(dockActions())
    seat.setMode('dock')
    expect(instance.getSnapshot().layoutInfo.rightPanelMode).toBe('dock')
    seat.setMode('native')
    seat.dispose()
    expect(seat.dock?.()).toBeUndefined()
    seat.registerDock(dockActions())()
    seat.setMode('dock')
    expect(seat.mode()).toBe('native')
    off()
    expect(createRightPanelSeat(createLayoutStore().create()).dock?.()).toBeUndefined()
  })
})
