import { createActor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TAB_PREFERENCES, tabsMachine } from './tabs-machine.js'
import type { TabTarget } from '@dshfiles/workbench/tabs'
import { createWorkbenchTabsActions } from './workbench-tab-actions.js'
import { createWorkbenchTabsPublication } from './workbench-tabs-publication.js'
import { connectWorkbenchTabs, workbenchTabs, type WorkbenchTab, type WorkbenchTabsSnapshot } from './workbench-tabs.js'

interface DockingFixturePort {
  dockAside?: (tabId: string) => boolean | undefined
}

const start = (dockAside?: (tabId: string) => boolean | undefined) => {
  const navigate = vi.fn(() => true)
  const actor = createActor(tabsMachine, { input: { ports: { navigate, save: vi.fn() }, persisted: null } }).start()
  actor.send({ type: 'preferences.changed', preferences: DEFAULT_TAB_PREFERENCES })
  const currentSet = () => {
    const snapshot = actor.getSnapshot()
    return snapshot.context.sets[snapshot.context.scopeKey]
  }
  const threadAside = vi.fn(() => false)
  const panelAside = vi.fn(() => false)
  const reselect = vi.fn()
  const startSession = vi.fn()
  const docking: DockingFixturePort = {}
  if (dockAside !== undefined) docking.dockAside = dockAside
  const actions = createWorkbenchTabsActions({
    enabled: () => actor.getSnapshot().matches('on'),
    currentSet,
    send: event => actor.send(event),
    reselect,
    ...docking,
    threadAside,
    panelAside,
    renameThread: vi.fn(async () => undefined),
    startSession,
  })
  const publication = createWorkbenchTabsPublication(actions)
  const publish = (status: 'running' | 'unread' | null = null): void => {
    const set = currentSet()
    const tabs = (set?.tabs ?? []).map((tab): WorkbenchTab => {
      const base = {
        id: tab.id,
        target: tab.target,
        title: tab.title ?? tab.id,
        pinned: tab.pinned,
        preview: tab.preview,
        active: tab.id === set?.activeTabId,
        available: true,
        status,
      }
      if (tab.target.kind === 'thread') return { ...base, kind: 'thread', sessionId: tab.target.sessionId }
      if (tab.target.kind === 'panel') return { ...base, kind: 'panel', panelId: tab.target.panelId }
      return { ...base, kind: 'start' }
    })
    publication.update(
      { enabled: actor.getSnapshot().matches('on'), scopeKey: actor.getSnapshot().context.scopeKey, activeTabId: set?.activeTabId ?? null, tabs },
      () => 'existing Start page',
    )
  }
  const open = (target: TabTarget, newTab = false) => actions.open(target, newTab)
  return { actor, actions, currentSet, navigate, reselect, startSession, threadAside, panelAside, publication, publish, open }
}

afterEach(() => {
  globalThis.dshfilesWorkbenchTabsV1 = undefined
})

describe('workbench tabs semantics bridge', () => {
  it('shares the page channel across duplicated module imports without creating an actor', async () => {
    const bridge = workbenchTabs()
    const empty = bridge.getSnapshot()
    expect(empty.enabled).toBe(false)
    expect(bridge.getSnapshot()).toBe(empty)
    vi.resetModules()
    const duplicate = await import('./workbench-tabs.js')
    expect(duplicate.workbenchTabs()).toBe(bridge)
    expect(bridge.actions.moveAside('missing')).toBe(false)
  })

  it('publishes the current set and live metadata without navigating during adoption', () => {
    const tabs = start()
    const bridge = workbenchTabs()
    tabs.open({ kind: 'thread', sessionId: 'a' })
    tabs.publish('running')
    const disconnect = connectWorkbenchTabs(tabs.publication.provider)
    const listener = vi.fn()
    const unsubscribe = bridge.subscribe(listener)
    const snapshot = bridge.getSnapshot()
    expect(snapshot.tabs[0]).toMatchObject({ id: 'thread:a', kind: 'thread', status: 'running', preview: true, target: { kind: 'thread', sessionId: 'a' } })
    const navigationCount = tabs.navigate.mock.calls.length
    // Reconciling the same selected tab must not start a new navigate/report cycle.
    bridge.actions.activate(snapshot.activeTabId ?? '')
    tabs.publish('running')
    expect(bridge.getSnapshot()).toBe(snapshot)
    expect(listener).not.toHaveBeenCalled()
    tabs.publish('unread')
    expect(bridge.getSnapshot().tabs[0]?.status).toBe('unread')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(tabs.navigate).toHaveBeenCalledTimes(navigationCount)
    expect(tabs.reselect).toHaveBeenCalledExactlyOnceWith('thread:a')
    expect(bridge.renderStart()).toBe('existing Start page')
    unsubscribe()
    disconnect()
    expect(bridge.getSnapshot().enabled).toBe(false)
    tabs.actor.stop()
  })

  it('publishes the close-button position as Workbench presentation metadata', () => {
    const tabs = start()
    const snapshot: WorkbenchTabsSnapshot = {
      enabled: true,
      closeButtonPosition: 'right',
      scopeKey: 'project:test',
      activeTabId: null,
      tabs: [],
    }
    tabs.publication.update(snapshot, () => null)
    expect(tabs.publication.provider.getSnapshot().closeButtonPosition).toBe('right')
    tabs.actor.stop()
  })

  it('starts a New thread through the page channel and keeps the stale host thread from reclaiming the tab', () => {
    const tabs = start()
    const disconnect = connectWorkbenchTabs(tabs.publication.provider)
    tabs.actor.send({ type: 'host.navigated', target: { kind: 'thread', sessionId: 'a' }, projectId: null })
    workbenchTabs().actions.newThread?.()
    expect(tabs.startSession).toHaveBeenCalledOnce()
    tabs.actor.send({ type: 'host.navigated', target: null, projectId: null })
    tabs.actor.send({ type: 'host.navigated', target: { kind: 'thread', sessionId: 'a' }, projectId: null })
    expect(tabs.currentSet()?.activeTabId).toBeNull()
    tabs.actor.send({ type: 'preferences.changed', preferences: { ...DEFAULT_TAB_PREFERENCES, enabled: false } })
    workbenchTabs().actions.newThread?.()
    expect(tabs.startSession).toHaveBeenCalledOnce()
    disconnect()
    tabs.actor.stop()
  })

  it('publishes the authoritative current Session independently of the active semantic tool without changing actor tabs', () => {
    const tabs = start()
    tabs.open({ kind: 'thread', sessionId: 'a' }, true)
    tabs.open({ kind: 'panel', panelId: 'editor' }, true)
    let currentSessionId: string | undefined = 'a'
    const publication = createWorkbenchTabsPublication(tabs.actions, {}, () => currentSessionId)
    tabs.publish()
    const semantic = tabs.publication.provider.getSnapshot()
    const actorBefore = tabs.actor.getSnapshot()
    publication.update(semantic, () => null)
    expect(publication.provider.getSnapshot()).toMatchObject({ currentSessionId: 'a', activeTabId: 'panel:editor' })
    expect(publication.provider.getSnapshot().tabs).toBe(semantic.tabs)
    const listener = vi.fn()
    publication.provider.subscribe(listener)
    currentSessionId = 'b'
    publication.update(semantic, () => null)
    expect(publication.provider.getSnapshot()).toMatchObject({ currentSessionId: 'b', activeTabId: 'panel:editor' })
    expect(listener).toHaveBeenCalledOnce()
    currentSessionId = undefined
    publication.update(semantic, () => null)
    expect(publication.provider.getSnapshot().currentSessionId).toBeUndefined()
    expect(tabs.actor.getSnapshot()).toBe(actorBefore)
    tabs.actor.stop()
  })

  it('forwards native menu presentation and localized labels through the public provider channel', () => {
    const tabs = start()
    const renderTabMenu = vi.fn(() => 'native menu')
    const label = vi.fn((key: string, title?: string) => `${key}:${title ?? ''}`)
    const publication = createWorkbenchTabsPublication(tabs.actions, { renderTabMenu, label })
    const disconnect = connectWorkbenchTabs(publication.provider)
    const bridge = workbenchTabs()
    const rename = vi.fn()
    const report = vi.fn()
    expect(bridge.renderTabMenu?.('thread:a', rename, report)).toBe('native menu')
    expect(renderTabMenu).toHaveBeenCalledExactlyOnceWith('thread:a', rename, report)
    expect(bridge.label?.('closeTab', 'A')).toBe('closeTab:A')
    expect(label).toHaveBeenCalledExactlyOnceWith('closeTab', 'A')
    disconnect()
    expect(bridge.renderTabMenu?.('thread:a', rename)).toBeNull()
    expect(bridge.label?.('closeTab', 'A')).toBe('')
    tabs.actor.stop()
  })

  it('keeps preview, pin, close-neighbour and scoped panel semantics on the existing actor', () => {
    const tabs = start()
    tabs.open({ kind: 'thread', sessionId: 'a' })
    tabs.actions.keep('thread:a')
    tabs.open({ kind: 'thread', sessionId: 'b' })
    tabs.open({ kind: 'thread', sessionId: 'c' })
    expect(tabs.currentSet()?.tabs.map(tab => tab.id)).toEqual(['thread:a', 'thread:c'])
    tabs.actions.togglePin('thread:a')
    tabs.actions.closeOthers('thread:c')
    expect(tabs.currentSet()?.tabs[0]).toMatchObject({ id: 'thread:a', pinned: true, preview: false })
    tabs.actions.open({ kind: 'panel', panelId: 'jujutsu', scope: 'one' }, true, 'Repository one')
    tabs.actions.open({ kind: 'panel', panelId: 'jujutsu', scope: 'two' }, true, 'Repository two')
    tabs.actions.activate('panel:jujutsu#one')
    expect(tabs.navigate).toHaveBeenLastCalledWith({ kind: 'panel', panelId: 'jujutsu', scope: 'one' })
    tabs.actions.close('panel:jujutsu#one')
    expect(tabs.currentSet()?.activeTabId).toBe('panel:jujutsu#two')
    tabs.publish()
    expect(tabs.publication.provider.getSnapshot().tabs.at(-1)).toMatchObject({ title: 'Repository two', target: { kind: 'panel', scope: 'two' } })
    tabs.actor.stop()
  })

  it('moves the same pinned thread and scoped panel through Workbench without closing actor state or opening independent panes', () => {
    const dockAside = vi.fn(() => true)
    const tabs = start(dockAside)
    tabs.open({ kind: 'thread', sessionId: 'a' })
    tabs.actions.keep('thread:a')
    tabs.actions.togglePin('thread:a')
    tabs.open({ kind: 'panel', panelId: 'jujutsu', scope: 'one' }, true)
    const before = tabs.currentSet()
    const navigations = tabs.navigate.mock.calls.length
    expect(tabs.actions.moveAside('thread:a')).toBe(true)
    expect(tabs.actions.moveAside('panel:jujutsu#one')).toBe(true)
    expect(dockAside.mock.calls).toEqual([['thread:a'], ['panel:jujutsu#one']])
    expect(tabs.currentSet()).toBe(before)
    expect(tabs.currentSet()?.tabs).toHaveLength(2)
    expect(tabs.currentSet()?.tabs[0]).toMatchObject({ id: 'thread:a', pinned: true, preview: false })
    expect(tabs.threadAside).not.toHaveBeenCalled()
    expect(tabs.panelAside).not.toHaveBeenCalled()
    expect(tabs.navigate).toHaveBeenCalledTimes(navigations)
    tabs.actor.stop()
  })

  it('does not fall back to a legacy aside or remove a tab when Workbench rejects docking', () => {
    const dockAside = vi.fn(() => false)
    const tabs = start(dockAside)
    tabs.open({ kind: 'thread', sessionId: 'a' })
    tabs.threadAside.mockReturnValue(true)
    const before = tabs.currentSet()
    expect(tabs.actions.moveAside('thread:a')).toBe(false)
    expect(tabs.currentSet()).toBe(before)
    expect(tabs.threadAside).not.toHaveBeenCalled()
    expect(tabs.actions.moveAside('missing')).toBe(false)
    expect(dockAside).toHaveBeenCalledTimes(1)
    tabs.actor.stop()
  })

  it('retains native accepted-aside close behavior when the docking owner delegates', () => {
    const dockAside = vi.fn(() => undefined)
    const tabs = start(dockAside)
    tabs.open({ kind: 'thread', sessionId: 'a' })
    tabs.threadAside.mockReturnValue(true)
    expect(tabs.actions.moveAside('thread:a')).toBe(true)
    expect(dockAside).toHaveBeenCalledExactlyOnceWith('thread:a')
    expect(tabs.threadAside).toHaveBeenCalledExactlyOnceWith('a')
    expect(tabs.currentSet()?.tabs.some(tab => tab.id === 'thread:a')).toBe(false)
    tabs.actor.stop()
  })

  it('moves aside only after acceptance and ignores stale, start and disabled actions', () => {
    const tabs = start()
    tabs.open({ kind: 'thread', sessionId: 'a' }, true)
    expect(tabs.actions.moveAside('thread:a')).toBe(false)
    expect(tabs.currentSet()?.tabs).toHaveLength(1)
    tabs.threadAside.mockReturnValue(true)
    expect(tabs.actions.moveAside('thread:a')).toBe(true)
    expect(tabs.currentSet()?.tabs).toHaveLength(0)
    tabs.actions.open({ kind: 'panel', panelId: 'jujutsu', scope: 'one' }, true)
    tabs.panelAside.mockReturnValue(true)
    expect(tabs.actions.moveAside('panel:jujutsu#one')).toBe(true)
    expect(tabs.panelAside).toHaveBeenCalledWith('jujutsu')
    tabs.actions.newTab()
    expect(tabs.actions.moveAside('start')).toBe(false)
    tabs.actions.activate('gone')
    tabs.actor.send({ type: 'preferences.changed', preferences: { ...DEFAULT_TAB_PREFERENCES, enabled: false } })
    const before = tabs.currentSet()
    tabs.actions.open({ kind: 'thread', sessionId: 'b' })
    tabs.actions.close('start')
    expect(tabs.currentSet()).toBe(before)
    tabs.actor.stop()
  })

  it('refreshes active Start suggestions without publishing equal inactive tab metadata', () => {
    const tabs = start()
    tabs.actions.newTab()
    tabs.publish()
    const provider = tabs.publication.provider
    const listener = vi.fn()
    provider.subscribe(listener)
    const before = provider.getSnapshot()
    const version = Symbol('Start content')
    tabs.publication.update(before, () => 'new suggestions', version)
    expect(provider.getSnapshot()).not.toBe(before)
    expect(provider.renderStart()).toBe('new suggestions')
    expect(listener).toHaveBeenCalledTimes(1)
    tabs.publication.update(provider.getSnapshot(), () => 'same suggestions', version)
    expect(listener).toHaveBeenCalledTimes(1)
    tabs.actor.stop()
  })

  it('retains snapshot identity for stable object content tokens and refreshes when their reference changes', () => {
    const tabs = start()
    tabs.actions.newTab()
    tabs.publish()
    const provider = tabs.publication.provider
    const listener = vi.fn()
    provider.subscribe(listener)
    const version = { byId: {}, statuses: new Map(), catalog: [], panelVersion: '1' }
    tabs.publication.update(provider.getSnapshot(), () => 'memoized suggestions', version)
    const before = provider.getSnapshot()
    tabs.publication.update(before, () => 'memoized suggestions', version)
    expect(provider.getSnapshot()).toBe(before)
    expect(listener).toHaveBeenCalledTimes(1)
    tabs.publication.update(before, () => 'changed suggestions', { ...version })
    expect(provider.getSnapshot()).not.toBe(before)
    expect(provider.renderStart()).toBe('changed suggestions')
    expect(listener).toHaveBeenCalledTimes(2)
    tabs.actor.stop()
  })

  it('keeps the replacement provider when an old bundle disposes and unsubscribes on removal', () => {
    const bridge = workbenchTabs()
    const old = start()
    const current = start()
    old.open({ kind: 'thread', sessionId: 'old' })
    current.open({ kind: 'thread', sessionId: 'current' })
    old.publish()
    current.publish()
    const disconnectOld = connectWorkbenchTabs(old.publication.provider)
    const disconnectCurrent = connectWorkbenchTabs(current.publication.provider)
    disconnectOld()
    expect(bridge.getSnapshot().activeTabId).toBe('thread:current')
    const listener = vi.fn()
    bridge.subscribe(listener)
    old.publish('unread')
    expect(listener).not.toHaveBeenCalled()
    disconnectCurrent()
    expect(listener).toHaveBeenCalledTimes(1)
    const empty: WorkbenchTabsSnapshot = bridge.getSnapshot()
    current.publish('unread')
    expect(bridge.getSnapshot()).toBe(empty)
    expect(listener).toHaveBeenCalledTimes(1)
    old.actor.stop()
    current.actor.stop()
  })
})
