import { createDockview } from 'dockview-react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { NewThreadSource } from './new-thread-source.js'
import { tabPanelId } from './tab-panels.js'
import { connectWorkbenchTabs, type WorkbenchTab, type WorkbenchTabsSnapshot } from './tabs.js'

const thread = (sessionId: string): WorkbenchTab => ({
  id: `thread:${sessionId}`,
  kind: 'thread',
  target: { kind: 'thread', sessionId },
  sessionId,
  title: sessionId,
  active: true,
  pinned: false,
  preview: false,
  available: true,
  status: null,
})

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})
const disposers: (() => void)[] = []
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
})

const provide = (initial: WorkbenchTabsSnapshot) => {
  let snapshot = initial
  const newThread = vi.fn()
  disposers.push(
    connectWorkbenchTabs({
      getSnapshot: () => snapshot,
      subscribe: () => () => undefined,
      renderStart: () => null,
      actions: {
        activate: vi.fn(),
        close: vi.fn(),
        keep: vi.fn(),
        togglePin: vi.fn(),
        move: vi.fn(),
        closeOthers: vi.fn(),
        closeToRight: vi.fn(),
        moveAside: vi.fn(() => false),
        open: vi.fn(),
        newTab: vi.fn(),
        newThread,
        renameThread: vi.fn(async () => undefined),
      },
    }),
  )
  return {
    newThread,
    publish: (next: Partial<WorkbenchTabsSnapshot>) => {
      snapshot = { ...snapshot, ...next }
    },
  }
}

const surface = () => {
  const api = createDockview(document.createElement('div'), {
    createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
  })
  disposers.push(() => api.dispose())
  return api
}
const unrelated = { id: 'backlog', title: 'Backlog', component: () => null }

it('starts the provider New thread and seats only the thread it created where the chooser asked', () => {
  const tabs = provide({ enabled: true, scopeKey: 'project:a', activeTabId: 'thread:a', tabs: [thread('a')] })
  const api = surface()
  const seat = vi.fn()
  const source = NewThreadSource.create(seat)
  const selection = { replacePanelId: 'dshfiles-workbench.new-view/chooser' }
  expect(source.open(unrelated, api, selection)).toBe(false)
  expect(tabs.newThread).not.toHaveBeenCalled()
  expect(source.open(source.definition, api, selection)).toBe(true)
  expect(tabs.newThread).toHaveBeenCalledOnce()
  expect(source.admit(tabPanelId('thread:a'))).toBe(false)
  tabs.publish({ activeTabId: 'thread:b', tabs: [thread('a'), thread('b')] })
  expect(source.admit(tabPanelId('thread:b'))).toBe(true)
  expect(seat).toHaveBeenCalledExactlyOnceWith(api, tabPanelId('thread:b'), selection)
  tabs.publish({ activeTabId: 'thread:c', tabs: [thread('a'), thread('b'), thread('c')] })
  expect(source.admit(tabPanelId('thread:c'))).toBe(false)
})

it('leaves default placement to a thread created after a scope change or a reset', () => {
  const tabs = provide({ enabled: true, scopeKey: 'project:a', activeTabId: null, tabs: [] })
  const api = surface()
  const seat = vi.fn()
  const source = NewThreadSource.create(seat)
  source.open(source.definition, api)
  tabs.publish({ scopeKey: 'project:b', activeTabId: 'thread:b', tabs: [thread('b')] })
  expect(source.admit(tabPanelId('thread:b'))).toBe(false)
  source.open(source.definition, api)
  source.clear()
  tabs.publish({ activeTabId: 'thread:c', tabs: [thread('b'), thread('c')] })
  expect(source.admit(tabPanelId('thread:c'))).toBe(false)
  expect(seat).not.toHaveBeenCalled()
})
