import { describe, expect, it, vi } from 'vitest'
import { SidebarResourcePanelModel, type SidebarResourcePanel } from './resource-panels.js'

const panel = (sessionId: string, tabId: string): SidebarResourcePanel => ({
  id: SidebarResourcePanelModel.id(sessionId, tabId),
  sessionId,
  tabId,
  kind: 'terminal',
  title: 'Terminal',
  address: 'sidebar://terminal/1',
  navigationRevision: 1,
})

describe('addressable resource presentation bridge', () => {
  it('keeps session identity distinct and replaces projections without an intermediate close', () => {
    const registry = SidebarResourcePanelModel.create()
    const a = panel('a', 'tab1')
    const b = panel('b', 'tab1')
    const first = registry.publish('a', [a], vi.fn())
    registry.publish('b', [b], vi.fn())
    const changed = vi.fn()
    registry.subscribe(changed)
    registry.publish('a', [{ ...a, title: 'Shell' }], vi.fn())
    first()
    expect(registry.list()).toEqual([{ ...a, title: 'Shell' }, b])
    expect(changed).toHaveBeenCalledTimes(1)
    expect(a.id).not.toBe(b.id)
  })

  it('keeps exact page admission with the native owner and ignores stale opener disposal', () => {
    const registry = SidebarResourcePanelModel.create()
    const report = vi.fn()
    expect(registry.openPage?.('terminal', report)).toBe(false)
    const first = vi.fn(() => false)
    const releaseFirst = registry.registerPageOpener?.(first)
    const second = vi.fn((_kind: string, beforePublish: (id: string) => void) => {
      beforePublish('native-owner-id')
      return true
    })
    const releaseSecond = registry.registerPageOpener?.(second)
    releaseFirst?.()
    expect(registry.openPage?.('terminal', report)).toBe(true)
    expect(report).toHaveBeenCalledWith('native-owner-id')
    expect(first).not.toHaveBeenCalled()
    expect(registry.list()).toEqual([])
    releaseSecond?.()
    expect(registry.openPage?.('terminal', report)).toBe(false)
  })

  it('moves presentation targets without closing resource lifetimes and ignores stale detach', () => {
    const registry = SidebarResourcePanelModel.create()
    const item = panel('a', 'tab1')
    const close = vi.fn()
    registry.publish('a', [item], close)
    const first = registry.attach(item.id, document.createElement('div'))
    const target = document.createElement('div')
    const second = registry.attach(item.id, target)
    first()
    expect(registry.targets.getSnapshot()).toEqual([{ id: item.id, element: target, visible: true }])
    second()
    expect(registry.targets.getSnapshot()).toEqual([])
    expect(registry.list()).toEqual([item])
    expect(close).not.toHaveBeenCalled()
  })

  it('routes explicit close to its owning session and preserves membership on cleanup failure', () => {
    const registry = SidebarResourcePanelModel.create()
    const a = panel('a', 'tab1')
    const b = panel('b', 'tab1')
    const closeA = vi.fn()
    const closeB = vi.fn(() => {
      throw new Error('cleanup rejected')
    })
    registry.publish('a', [a], closeA)
    registry.publish('b', [b], closeB)
    expect(() => registry.close(b.id)).toThrow('cleanup rejected')
    expect(registry.list()).toEqual([a, b])
    expect(closeA).not.toHaveBeenCalled()
    expect(closeB).toHaveBeenCalledWith('tab1')
  })
})
