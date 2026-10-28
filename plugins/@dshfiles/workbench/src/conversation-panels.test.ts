import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ConversationPanels } from './conversation-panels.js'
import { WORKBENCH_COMPONENT } from './layout-store.js'
import type { WorkbenchTabsSnapshot } from './tabs.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})
const apis: DockviewApi[] = []
afterEach(() => apis.splice(0).forEach(api => api.dispose()))
const surface = () => {
  const api = createDockview(document.createElement('div'), { createComponent: () => ({ element: document.createElement('div'), init: () => undefined }) })
  api.layout(1000, 600)
  apis.push(api)
  return api
}
const snapshot: WorkbenchTabsSnapshot = { enabled: true, currentSessionId: 'session-a', scopeKey: 'global', activeTabId: null, tabs: [] }

describe('ConversationPanels', () => {
  it('permits an unmaterialized New thread but never mistakes a retained closed chat for a blank', () => {
    expect(ConversationPanels.blank({ ...snapshot, currentSessionId: undefined })).toBe(true)
    expect(ConversationPanels.blank(snapshot)).toBe(false)
    const thread = {
      id: 'thread-a',
      kind: 'thread' as const,
      sessionId: 'session-a',
      target: { kind: 'thread' as const, sessionId: 'session-a' },
      title: 'A',
      active: true,
      pinned: false,
      preview: false,
      available: true,
      status: null,
    }
    expect(ConversationPanels.blank({ ...snapshot, tabs: [thread] })).toBe(false)
  })

  it('does not resurrect the closed last conversation from the retained native default', () => {
    const api = surface()
    api.addPanel({ id: 'conversation', component: WORKBENCH_COMPONENT })
    const openBlank = vi.fn()
    ConversationPanels.reconcile({ snapshot, blank: false, surfaces: [api], openBlank })
    expect(api.panels).toHaveLength(0)
    expect(openBlank).not.toHaveBeenCalled()
  })

  it('retires all legacy global-following clones without changing a fixed conversation identity', () => {
    const api = surface()
    const fixed = api.addPanel({ id: 'tab/fixed-a', component: WORKBENCH_COMPONENT })
    api.addPanel({ id: 'current-conversation', component: WORKBENCH_COMPONENT })
    api.addPanel({ id: 'view/current-conversation/old', component: WORKBENCH_COMPONENT, params: { sourceId: 'current-conversation' } })
    api.addPanel({ id: 'workspace-editor', component: WORKBENCH_COMPONENT })
    ConversationPanels.reconcile({ snapshot, blank: false, surfaces: [api], openBlank: vi.fn() })
    expect(api.getPanel('tab/fixed-a')).toBe(fixed)
    expect(api.panels.map(panel => panel.id)).toEqual(['tab/fixed-a', 'workspace-editor'])
  })

  it('keeps only one unmaterialized New thread fallback and opens it only when needed', () => {
    const snapshot: WorkbenchTabsSnapshot = { enabled: true, currentSessionId: undefined, scopeKey: 'global', activeTabId: null, tabs: [] }
    const main = surface()
    const aside = surface()
    main.addPanel({ id: 'conversation', component: WORKBENCH_COMPONENT })
    aside.addPanel({ id: 'current-conversation', component: WORKBENCH_COMPONENT })
    const openBlank = vi.fn()
    ConversationPanels.reconcile({ snapshot, blank: true, surfaces: [main, aside], openBlank })
    expect(main.getPanel('conversation')).toBeDefined()
    expect(aside.panels).toHaveLength(0)
    expect(openBlank).not.toHaveBeenCalled()
    main.clear()
    ConversationPanels.reconcile({ snapshot, blank: true, surfaces: [main, aside], openBlank })
    expect(openBlank).toHaveBeenCalledOnce()
  })

  it('leaves compatibility rendering untouched until the semantic provider is ready', () => {
    const api = surface()
    api.addPanel({ id: 'conversation', component: WORKBENCH_COMPONENT })
    ConversationPanels.reconcile({ snapshot: { ...snapshot, enabled: false }, blank: false, surfaces: [api], openBlank: vi.fn() })
    expect(api.getPanel('conversation')).toBeDefined()
  })
})
