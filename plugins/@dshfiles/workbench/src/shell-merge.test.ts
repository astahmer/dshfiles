import { Orientation, type SerializedDockview } from 'dockview-react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WORKBENCH_COMPONENT } from './layout-store.js'
import { WorkbenchPorts, SHELL_MERGE_BACKUP_NAME, ShellMerge, SIDEBAR_PANE_ID } from './shell-merge.js'

const layout = (ids: readonly string[]): SerializedDockview => ({
  grid: { root: { type: 'branch', data: [] }, width: 280, height: 800, orientation: Orientation.VERTICAL },
  panels: Object.fromEntries(ids.map(id => [id, { id, contentComponent: WORKBENCH_COMPONENT, title: id }])),
})

const oldDocking = layout(['dshfiles-thread-sidebar.workbench-navigation', 'dshfiles-thread-sidebar.workbench-threads'])

afterEach(() => {
  globalThis.dshfilesWorkbenchShellMergeV1 = undefined
  globalThis.dshfilesWorkbenchLeftKeepV1 = undefined
})

describe('ShellMerge.plan', () => {
  it('keeps a formerly Fixed browser’s dormant docking layout as a named layout and starts the left region from the default', () => {
    const plan = ShellMerge.plan({ request: { former: 'fixed', firstOnHost: true }, left: oldDocking, savedLayouts: { Mine: { main: null } } })
    expect(plan.resetLeft).toBe(true)
    expect(plan.showMainTabs).toBe(false)
    expect(plan.savedLayouts).toEqual({ Mine: { main: null }, [SHELL_MERGE_BACKUP_NAME]: { left: oldDocking } })
  })

  it('changes nothing for a formerly Fixed browser that never docked', () => {
    expect(ShellMerge.plan({ request: { former: 'fixed', firstOnHost: true }, left: null, savedLayouts: {} })).toEqual({
      savedLayouts: undefined,
      resetLeft: false,
      showMainTabs: false,
    })
  })

  it('keeps a formerly Free docking layout verbatim and turns the main tabs on only for the page that writes the Host marker', () => {
    expect(ShellMerge.plan({ request: { former: 'docking', firstOnHost: true }, left: oldDocking, savedLayouts: {} })).toEqual({
      savedLayouts: undefined,
      resetLeft: false,
      showMainTabs: true,
    })
    expect(ShellMerge.plan({ request: { former: 'docking', firstOnHost: false }, left: oldDocking, savedLayouts: {} }).showMainTabs).toBe(false)
  })

  it('never resets a layout made after the merge, and never overwrites a named layout already called the backup name', () => {
    const merged = layout([SIDEBAR_PANE_ID, 'dshfiles-changes.panel'])
    expect(ShellMerge.plan({ request: { former: 'fixed', firstOnHost: false }, left: merged, savedLayouts: {} }).resetLeft).toBe(false)
    const taken = { [SHELL_MERGE_BACKUP_NAME]: { main: null } }
    const plan = ShellMerge.plan({ request: { former: 'fixed', firstOnHost: false }, left: oldDocking, savedLayouts: taken })
    expect(plan.savedLayouts).toBeUndefined()
    expect(plan.resetLeft).toBe(true)
  })
})

describe('workbenchShellMerge', () => {
  it('keeps the latest request until the Workbench takes it, whichever bundle loads first', () => {
    WorkbenchPorts.shellMerge().request({ former: 'fixed', firstOnHost: false })
    const listener = vi.fn()
    const unsubscribe = WorkbenchPorts.shellMerge().subscribe(listener)
    WorkbenchPorts.shellMerge().request({ former: 'docking', firstOnHost: true })
    expect(listener).toHaveBeenCalledOnce()
    expect(WorkbenchPorts.shellMerge().take()).toEqual({ former: 'docking', firstOnHost: true })
    expect(WorkbenchPorts.shellMerge().take()).toBeUndefined()
    unsubscribe()
  })
})

describe('workbenchLeftKeep', () => {
  it('queues the final keep intent per panel until the left region takes it', () => {
    const listener = vi.fn()
    WorkbenchPorts.leftKeep().subscribe(listener)
    WorkbenchPorts.leftKeep().request({ viewId: 'traces', keep: true })
    WorkbenchPorts.leftKeep().request({ viewId: 'usage', keep: true })
    WorkbenchPorts.leftKeep().request({ viewId: 'traces', keep: false })
    expect(listener).toHaveBeenCalledTimes(3)
    expect(WorkbenchPorts.leftKeep().take()).toEqual([
      { viewId: 'usage', keep: true },
      { viewId: 'traces', keep: false },
    ])
    expect(WorkbenchPorts.leftKeep().take()).toEqual([])
  })
})

describe('workbenchLayoutReset', () => {
  it('tells every subscriber once per Reset layout and stops after unsubscribe', () => {
    const listener = vi.fn()
    const stop = WorkbenchPorts.layoutReset().subscribe(listener)
    WorkbenchPorts.layoutReset().notify()
    stop()
    WorkbenchPorts.layoutReset().notify()
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
