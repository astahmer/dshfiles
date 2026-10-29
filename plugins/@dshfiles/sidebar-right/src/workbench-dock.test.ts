import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { ShortcutCommand, Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DockPaneActions } from '@dshfiles/frame-layout/regions'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createSidebarRightController, SidebarRightUnavailableError, type SidebarRightHost } from './native/client/service.ts'
import { registerSidebarShortcuts } from './native/client/shortcuts.ts'
import { createSidebarRightStore } from './native/client/stores.ts'
import { SidebarRightTabRegistry } from './native/client/tab-registry.ts'

const releases: (() => void)[] = []
beforeEach(() => localStorage.clear())
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release()
  localStorage.clear()
})

/** Explicit frame presentation seam; native Session stores and TabDomain remain real. */
function dockPane(): DockPaneActions {
  const state = createSnapshotStore(false)
  return {
    isOpen: state.getSnapshot,
    open: () => state.set(true),
    close: () => state.set(false),
    toggle: () => state.set(!state.getSnapshot()),
    subscribe: state.subscribe,
  }
}

function sidebar(host: Pick<SidebarRightHost, 'workbench' | 'dock'> = {}) {
  const ctx = new Context()
  const types = new SidebarRightTabRegistry(ctx)
  types.register({ id: 'file-owner', kind: 'file', patterns: ['dsh-resource://file/**'], title: () => 'File' })
  types.register({ id: 'terminal-owner', kind: 'terminal', multiple: true, title: () => 'Terminal' })
  types.register({ id: 'guide-owner', kind: 'guide', title: () => 'Guide' })
  types.register({ id: 'workbench-owner', kind: 'dshfiles-workbench-side-panel', title: () => 'Workbench' })
  const pin = vi.fn()
  const openWithFocus = vi.fn((_session: SessionId, open: () => unknown) => {
    open()
  })
  const owner = createSidebarRightController(types, pin, {
    autoFullscreen: () => false,
    openWithFocus,
    closeWithFocus: (_session, _pane, close) => {
      close()
    },
    ...host,
  })
  releases.push(() => owner.controller.tabDomain.dispose())
  return { ...owner, pin, openWithFocus }
}

function toggleCommand(controller: ReturnType<typeof sidebar>['controller']): ShortcutCommand {
  const commands: ShortcutCommand[] = []
  const shortcuts: Pick<Shortcuts, 'register' | 'runtime'> = {
    runtime: 'web',
    register: command => {
      commands.push(command)
      return () => {
        const index = commands.indexOf(command)
        if (index !== -1) commands.splice(index, 1)
      }
    },
  }
  releases.push(registerSidebarShortcuts(shortcuts, controller, key => key, vi.fn()))
  const command = commands.find(command => command.id === 'sidebar.right.toggle')
  if (command === undefined) throw new Error('expected registered right-sidebar toggle')
  return command
}

const keyContext = { target: null, region: 'page', modal: null } as const

it('reads and toggles the global Workbench dock without any selected Session', () => {
  const dock = dockPane()
  const owner = sidebar({ workbench: () => true, dock: () => dock })
  const notify = vi.fn()
  releases.push(dock.subscribe(notify))
  expect(owner.controller.mounted.getSnapshot()).toBeUndefined()
  expect(owner.controller.isExpanded()).toBe(false)
  owner.controller.toggleExpanded()
  expect(dock.isOpen()).toBe(true)
  expect(owner.controller.isExpanded()).toBe(true)
  dock.close()
  expect(owner.controller.isExpanded()).toBe(false)
  expect(notify).toHaveBeenCalledTimes(2)
  expect(owner.openWithFocus).not.toHaveBeenCalled()
})

it('publishes isExpanded as a snapshot that follows the dock and the on-screen Session', () => {
  const dock = dockPane()
  const owner = sidebar({ workbench: () => true, dock: () => dock })
  const seen: boolean[] = []
  releases.push(owner.controller.expanded.subscribe(() => seen.push(owner.controller.expanded.getSnapshot())))
  owner.controller.toggleExpanded()
  dock.close()
  owner.show('s1' as SessionId)
  expect(seen).toEqual([true, false, false])
})

it('preserves genuine resource occurrences, pins and native floating layout while toggling Workbench', () => {
  const dock = dockPane()
  let workbench = true
  const owner = sidebar({ workbench: () => workbench, dock: () => dock })
  // SAFETY: this stable fixture identity names the real store adopted below.
  const sessionId = 'dock-resource-session' as SessionId
  const store = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
  releases.push(owner.adopt(sessionId, store))
  owner.show(sessionId)
  owner.controller.openResource('dsh-resource://file/session/test/readme.md')
  const resource = owner.controller.tabsIn(sessionId)[0]
  if (resource === undefined) throw new Error('expected genuine resource record')
  owner.controller.float(resource.id)
  const occurrence = owner.controller.tabDomain.occurrence(sessionId, resource)
  const snapshot = store.getSnapshot()
  dock.close()
  // Native layout is expanded, but the user has closed the actual Workbench dock.
  expect(snapshot.bySession[sessionId]?.layout.expanded).toBe(true)
  expect(owner.controller.isExpanded()).toBe(false)
  owner.controller.toggleExpanded()
  owner.controller.toggleExpanded()
  expect(store.getSnapshot()).toBe(snapshot)
  expect(owner.controller.tabDomain.occurrence(sessionId, resource)).toBe(occurrence)
  expect(occurrence.signal.aborted).toBe(false)
  expect(owner.pin).toHaveBeenCalledWith(resource.contentId, occurrence.signal)
  workbench = false
  expect(owner.controller.isExpanded()).toBe(true)
  owner.controller.toggleExpanded()
  expect(owner.controller.isExpanded()).toBe(false)
  expect(store.getSnapshot()).not.toBe(snapshot)
  expect(dock.isOpen()).toBe(false)
  expect(occurrence.signal.aborted).toBe(false)
})

it('reveals explicit resource open/reopen/focus and terminal intents, but not passive restored stores', () => {
  const dock = dockPane()
  const owner = sidebar({ workbench: () => true, dock: () => dock })
  // SAFETY: stable fixture identity is the persistence scope of both genuine store instances.
  const sessionId = 'restored-resource-session' as SessionId
  const handle = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' }))
  const store = handle.create(sessionId)
  const release = owner.adopt(sessionId, store)
  releases.push(release)
  owner.show(sessionId)
  const address = 'dsh-resource://file/session/test/restore.md'
  owner.controller.openResource(address)
  expect(dock.isOpen()).toBe(true)
  const resource = owner.controller.tabsIn(sessionId)[0]
  if (resource === undefined) throw new Error('expected resource record')
  const held = owner.controller.tabDomain.occurrence(sessionId, resource)
  const revision = held.navigation.getSnapshot().revision
  dock.close()
  release()
  const restored = handle.create(sessionId)
  releases.push(owner.adopt(sessionId, restored))
  expect(owner.controller.tabsIn(sessionId).some(tab => tab.id === resource.id)).toBe(true)
  owner.show(undefined)
  owner.show(sessionId)
  expect(dock.isOpen()).toBe(false)
  owner.controller.openResource(address)
  expect(dock.isOpen()).toBe(true)
  expect(owner.controller.tabDomain.occurrence(sessionId, resource)).toBe(held)
  expect(held.navigation.getSnapshot().revision).toBeGreaterThan(revision)
  dock.close()
  owner.controller.focus(resource.id)
  expect(dock.isOpen()).toBe(true)
  dock.close()
  owner.controller.openTab('terminal')
  expect(dock.isOpen()).toBe(true)
  dock.close()
  owner.controller.openTab('guide')
  owner.controller.openTab('dshfiles-workbench-side-panel')
  expect(dock.isOpen()).toBe(false)
  expect(() => owner.controller.openResource('not-a-resource')).toThrow()
  expect(() => owner.controller.openTab('unregistered-kind')).toThrow()
  expect(dock.isOpen()).toBe(false)
})

it('admits exact independent terminal records before publication without revealing the right pane', () => {
  const dock = dockPane()
  const owner = sidebar({ workbench: () => true, dock: () => dock })
  // SAFETY: stable identities name the real adopted Session stores below.
  const sessionId = 'workbench-terminal-session' as SessionId
  const otherSession = 'other-terminal-session' as SessionId
  const handle = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' }))
  const store = handle.create(sessionId)
  releases.push(owner.adopt(sessionId, store))
  releases.push(owner.adopt(otherSession, handle.create(otherSession)))
  owner.show(sessionId)
  const reported: string[] = []
  const published: string[] = []
  releases.push(
    store.subscribe(() => {
      for (const tab of owner.controller.tabsIn(sessionId)) {
        if (tab.kind !== 'terminal') continue
        expect(reported).toContain(tab.id)
        if (!published.includes(tab.id)) published.push(tab.id)
      }
    }),
  )
  const admit = vi.fn((capturedSession: SessionId, tabId: string) => {
    expect(capturedSession).toBe(sessionId)
    expect(owner.controller.tabsIn(sessionId).some(tab => tab.id === tabId)).toBe(false)
    reported.push(tabId)
    // Reentrant selection changes cannot retarget the already-captured owner.
    owner.show(otherSession)
  })
  expect(owner.controller.openWorkbenchPage('terminal', admit)).toBe(true)
  owner.show(sessionId)
  expect(owner.controller.openWorkbenchPage('terminal', admit)).toBe(true)
  expect(new Set(reported).size).toBe(2)
  expect(published).toEqual(reported)
  expect(dock.isOpen()).toBe(false)
  expect(owner.controller.tabsIn(otherSession).filter(tab => tab.kind === 'terminal')).toHaveLength(0)
  const terminal = owner.controller.tabsIn(sessionId).find(tab => tab.kind === 'terminal')
  if (terminal === undefined) throw new Error('expected native terminal record')
  const occurrence = owner.controller.tabDomain.occurrence(sessionId, terminal)
  const cleanup = vi.fn()
  releases.push(owner.controller.registerCloseHandler('terminal', cleanup))
  owner.show(otherSession)
  owner.controller.closeIn(sessionId, terminal.id)
  expect(cleanup).toHaveBeenCalledWith(sessionId, terminal)
  expect(occurrence.signal.aborted).toBe(true)
  expect(owner.controller.tabsIn(sessionId).some(tab => tab.id === terminal.id)).toBe(false)
  expect(dock.isOpen()).toBe(false)
})

it('refuses Workbench page allocation without a mounted adopted Session or registered provider', () => {
  const owner = sidebar({ workbench: () => true })
  const admission = vi.fn()
  expect(owner.controller.openWorkbenchPage('terminal', admission)).toBe(false)
  // SAFETY: this identity is intentionally not adopted to verify the ownership fence.
  owner.show('unadopted-terminal-session' as SessionId)
  expect(owner.controller.openWorkbenchPage('terminal', admission)).toBe(false)
  expect(owner.controller.openWorkbenchPage('unknown-kind', admission)).toBe(false)
  expect(admission).not.toHaveBeenCalled()
  const native = sidebar()
  expect(native.controller.openWorkbenchPage('terminal', admission)).toBe(false)
})

it('does not fall back to native state before dock registration or after dock disposal', () => {
  let dock: DockPaneActions | undefined
  const owner = sidebar({ workbench: () => true, dock: () => dock })
  expect(() => owner.controller.toggleExpanded()).not.toThrow()
  expect(owner.controller.isExpanded()).toBe(false)
  dock = dockPane()
  owner.controller.toggleExpanded()
  expect(owner.controller.isExpanded()).toBe(true)
  dock = undefined
  expect(() => owner.controller.toggleExpanded()).not.toThrow()
  expect(owner.controller.isExpanded()).toBe(false)
  expect(owner.openWithFocus).not.toHaveBeenCalled()
})

it('routes the actual registered keyboard command globally and resolves replacement dock actions at execution', () => {
  const first = dockPane()
  let current: DockPaneActions | undefined = first
  let workbench = true
  const owner = sidebar({ workbench: () => workbench, dock: () => current })
  const command = toggleCommand(owner.controller)
  const resolved = command.resolve(keyContext)
  expect(resolved.status).toBe('handled')
  if (resolved.status !== 'handled') throw new Error('global dock toggle must not require a Session')
  const replacement = dockPane()
  current = replacement
  resolved.run()
  expect(first.isOpen()).toBe(false)
  expect(replacement.isOpen()).toBe(true)
  resolved.run()
  expect(replacement.isOpen()).toBe(false)
  current = undefined
  expect(() => resolved.run()).not.toThrow()
  workbench = false
  expect(() => resolved.run()).not.toThrow()
  expect(command.resolve(keyContext).status).toBe('blocked')
})

it('retains the original native service and keyboard behavior when no Workbench contract is installed', () => {
  const owner = sidebar()
  const command = toggleCommand(owner.controller)
  expect(owner.controller.isExpanded()).toBe(false)
  expect(command.resolve(keyContext).status).toBe('blocked')
  expect(() => owner.controller.toggleExpanded()).toThrow(SidebarRightUnavailableError)
  // SAFETY: this stable fixture identity names the real native store adopted below.
  const sessionId = 'native-fallback-session' as SessionId
  const store = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' })).create()
  releases.push(owner.adopt(sessionId, store))
  store.actions.open(sessionId)
  owner.show(sessionId)
  const resolved = command.resolve(keyContext)
  expect(resolved.status).toBe('handled')
  if (resolved.status !== 'handled') throw new Error('expected native Session toggle')
  resolved.run()
  expect(owner.controller.isExpanded()).toBe(true)
  const close = command.resolve(keyContext)
  if (close.status !== 'handled') throw new Error('expected native collapse')
  close.run()
  expect(owner.controller.isExpanded()).toBe(false)
  expect(owner.openWithFocus).toHaveBeenCalledTimes(2)
})
