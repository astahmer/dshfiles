import { Context } from '@deepseek-ai/cordis'
import { createSnapshotStore, type ObservableSnapshot, type SnapshotSelectorHook } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { DockPaneActions } from '@dshfiles/frame-layout/regions'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { act, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createDockPaneActions } from '../../workbench/src/right-panel-mode.ts'
import { en, zh } from './native/client/locales.ts'
import { createSidebarRightController } from './native/client/service.ts'
import { ExpandButton } from './native/client/shell/ExpandButton.tsx'
import { createSidebarRightStore } from './native/client/stores.ts'
import { SidebarRightTabRegistry } from './native/client/tab-registry.ts'

// The existing public primitive adapter omits this glyph. Only drawing is replaced;
// real React roots, native stores/controller and Workbench StoredValue/actions run below.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async importOriginal => ({
  ...(await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()),
  IconPanelLeftOutlineRegular: () => <svg aria-hidden />,
}))

const releases: (() => void)[] = []
beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})
afterEach(() => {
  for (const release of releases.splice(0).reverse()) release()
  document.body.replaceChildren()
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** Explicit renderer hook seam over real observable sources, not a second state owner. */
function selectorHook<T>(source: ObservableSnapshot<T>): SnapshotSelectorHook<T> {
  return select => select(useSyncExternalStore(source.subscribe, source.getSnapshot, source.getSnapshot))
}

function fixture(workbench = true, copy = en) {
  // SAFETY: fixture identities name the genuine per-Session stores adopted below.
  const sessionId = 'header-session-a' as SessionId
  // SAFETY: this distinct retained identity names the second genuinely adopted native store.
  const sessionC = 'retained-session-c' as SessionId
  const mode = createSnapshotStore(workbench)
  const shortcuts = createSnapshotStore<readonly []>([])
  const visibility = createStoredValue({ key: 'header-right-pane', schema: z.boolean().nullable(), fallback: null })
  // Exercise the real Workbench factory through its explicit StoredValue injection seam.
  const dock = createDockPaneActions(visibility)
  const unsubscribe = vi.fn()
  const subscribe = vi.spyOn(dock, 'subscribe').mockImplementation(listener => {
    const release = visibility.subscribe(listener)
    return () => {
      release()
      unsubscribe()
    }
  })
  let currentDock: DockPaneActions | undefined = dock
  const handle = createSidebarRightStore(() => ({ kind: 'guide', title: 'Start' }))
  const store = handle.create(sessionId)
  const carrier = handle.create(sessionC)
  const owner = createSidebarRightController(new SidebarRightTabRegistry(new Context()), vi.fn(), {
    workbench: mode.getSnapshot,
    dock: () => currentDock,
    autoFullscreen: () => false,
    openWithFocus: (_session, open) => {
      open()
    },
    closeWithFocus: (_session, _pane, close) => {
      close()
    },
  })
  releases.push(() => owner.controller.tabDomain.dispose(), owner.adopt(sessionId, store), owner.adopt(sessionC, carrier))
  owner.show(sessionId)
  const dictionary = new Map(Object.entries(copy))
  const props: Parameters<typeof ExpandButton>[0] = {
    sessionId,
    useStore: selectorHook(store),
    actions: store.actions,
    useShortcuts: selectorHook(shortcuts),
    useWorkbenchMode: selectorHook(mode),
    t: key => dictionary.get(key) ?? key,
    dock: () => currentDock,
  }
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = () => act(() => root.render(<ExpandButton {...props} />))
  const unmount = () => act(() => root.unmount())
  releases.push(unmount)
  render()
  return {
    host,
    store,
    carrier,
    sessionId,
    sessionC,
    owner,
    mode,
    dock,
    visibility,
    subscribe,
    unsubscribe,
    render,
    unmount,
    replaceDock: (next: DockPaneActions | undefined) => {
      currentDock = next
    },
    button: () => host.querySelector<HTMLButtonElement>('button[data-sidebar-right-expand]'),
  }
}

it('opens the real Workbench dock from the header and reappears only after pane close', () => {
  const f = fixture()
  const button = f.button()
  expect(button?.getAttribute('aria-label')).toBe(en['chrome.expandAria'])
  if (button === null) throw new Error('expected closed-pane header opener')
  const snapshot = f.store.getSnapshot()
  act(() => button.click())
  expect(f.dock.isOpen()).toBe(true)
  expect(f.visibility.get()).toBe(true)
  expect(localStorage.getItem('header-right-pane')).toBe('true')
  expect(f.owner.controller.isExpanded()).toBe(true)
  expect(f.store.getSnapshot()).toBe(snapshot)
  expect(f.button()).toBeNull()
  act(() => f.dock.close())
  expect(f.button()).not.toBeNull()
  expect(f.visibility.get()).toBe(false)
  act(() => f.owner.controller.toggleExpanded())
  expect(f.button()).toBeNull()
  act(() => f.owner.controller.toggleExpanded())
  expect(f.button()).not.toBeNull()
})

it('ignores native carrier expansion including a different retained Session and releases its dock subscription', () => {
  const f = fixture()
  act(() => {
    f.store.actions.setExpanded(f.sessionId, true)
    f.carrier.actions.setExpanded(f.sessionC, true)
  })
  expect(f.button()).not.toBeNull()
  expect(f.dock.isOpen()).toBe(false)
  act(() => f.dock.open())
  act(() => {
    f.store.actions.setExpanded(f.sessionId, false)
    f.carrier.actions.setExpanded(f.sessionC, false)
  })
  expect(f.button()).toBeNull()
  expect(f.dock.isOpen()).toBe(true)
  f.unmount()
  expect(f.subscribe).toHaveBeenCalledOnce()
  expect(f.unsubscribe).toHaveBeenCalledOnce()
  act(() => f.dock.close())
  expect(f.host.childElementCount).toBe(0)
})

it('keeps native expand-only semantics and localized accessible copy without driving the dock', () => {
  const f = fixture(false, zh)
  expect(f.button()?.getAttribute('aria-label')).toBe(zh['chrome.expandAria'])
  act(() => f.button()?.click())
  expect(f.store.getSnapshot().bySession[f.sessionId]?.layout.expanded).toBe(true)
  expect(f.dock.isOpen()).toBe(false)
  expect(f.button()).toBeNull()
  expect(f.subscribe).not.toHaveBeenCalled()
  act(() => f.store.actions.setExpanded(f.sessionId, false))
  expect(f.button()).not.toBeNull()
  act(() => f.mode.set(true))
  act(() => f.dock.open())
  expect(f.button()).toBeNull()
  act(() => f.mode.set(false))
  expect(f.button()).not.toBeNull()
  expect(f.unsubscribe).toHaveBeenCalledOnce()
})

it('resolves current dock actions on click and never falls back to hidden native expansion', () => {
  const f = fixture()
  const replacement = createDockPaneActions(createStoredValue({ key: 'replacement-pane', schema: z.boolean().nullable(), fallback: null }))
  f.replaceDock(replacement)
  act(() => f.button()?.click())
  expect(replacement.isOpen()).toBe(true)
  expect(f.dock.isOpen()).toBe(false)
  f.render()
  expect(f.button()).toBeNull()
  f.replaceDock(undefined)
  f.render()
  expect(f.button()).not.toBeNull()
  const snapshot = f.store.getSnapshot()
  act(() => f.button()?.click())
  expect(f.store.getSnapshot()).toBe(snapshot)
})
