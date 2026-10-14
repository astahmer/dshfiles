import { createActor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TAB_PREFERENCES, tabsMachine, type PersistedTabs, type TabPreferences, type TabTarget } from './tabs-machine.js'

const thread = (sessionId: string): TabTarget => ({ kind: 'thread', sessionId })
const panel = (panelId: string): TabTarget => ({ kind: 'panel', panelId })

const start = (options: { readonly preferences?: Partial<TabPreferences>; readonly persisted?: PersistedTabs | null; readonly navigates?: boolean } = {}) => {
  const navigated: TabTarget[] = []
  const saved: PersistedTabs[] = []
  const actor = createActor(tabsMachine, {
    input: {
      ports: {
        navigate: target => {
          navigated.push(target)
          return options.navigates ?? true
        },
        save: tabs => saved.push(tabs),
      },
      persisted: options.persisted ?? null,
    },
  }).start()
  const preferences = { ...DEFAULT_TAB_PREFERENCES, ...options.preferences }
  const host = (target: TabTarget | null, projectId: string | null = null): void => actor.send({ type: 'host.navigated', target, projectId })
  const set = () => {
    const context = actor.getSnapshot().context
    return context.sets[context.scopeKey] ?? { tabs: [], activeTabId: null }
  }
  const ids = (): string[] => set().tabs.map(tab => tab.id)
  return { actor, navigated, saved, preferences, host, set, ids, enable: () => actor.send({ type: 'preferences.changed', preferences }) }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('tabsMachine', () => {
  it('opens a tab for whatever the main view shows, and focuses it when shown again', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.host(panel('jujutsu'))
    tabs.host(thread('a'))
    expect(tabs.ids()).toEqual(['thread:a', 'panel:jujutsu'])
    expect(tabs.set().activeTabId).toBe('thread:a')
  })

  it('waits for the settings before following, then adopts what the Host already shows', () => {
    const tabs = start()
    tabs.host(panel('workbench'))
    expect(tabs.ids()).toEqual([])
    tabs.enable()
    expect(tabs.ids()).toEqual(['panel:workbench'])
  })

  it('replaces the preview tab until it is kept, VS Code style', () => {
    const tabs = start({ preferences: { openMode: 'preview' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.host(thread('b'))
    expect(tabs.ids()).toEqual(['thread:b'])
    expect(tabs.set().tabs[0]?.preview).toBe(true)
    tabs.actor.send({ type: 'tab.keep', tabId: 'thread:b' })
    tabs.host(thread('c'))
    expect(tabs.ids()).toEqual(['thread:b', 'thread:c'])
  })

  it('replaces the active tab in replace mode, but never a pinned one', () => {
    const tabs = start({ preferences: { openMode: 'replace' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.host(thread('b'))
    expect(tabs.ids()).toEqual(['thread:b'])
    tabs.actor.send({ type: 'tab.togglePin', tabId: 'thread:b' })
    tabs.host(thread('c'))
    expect(tabs.ids()).toEqual(['thread:b', 'thread:c'])
  })

  it('closes the least recently used unpinned tab past the limit', () => {
    const tabs = start({ preferences: { openMode: 'new', maxTabs: 3 } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.actor.send({ type: 'tab.togglePin', tabId: 'thread:a' })
    tabs.host(thread('b'))
    tabs.host(thread('c'))
    tabs.host(thread('b'))
    tabs.host(thread('d'))
    expect(tabs.ids()).toEqual(['thread:a', 'thread:b', 'thread:d'])
  })

  it('navigates to a picked tab and ignores the Host passing through other views on the way', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.host(panel('usage'))
    tabs.actor.send({ type: 'tab.select', tabId: 'thread:a' })
    expect(tabs.navigated).toEqual([thread('a')])
    tabs.host(thread('stale'))
    expect(tabs.ids()).toEqual(['thread:a', 'panel:usage'])
    tabs.host(thread('a'))
    expect(tabs.actor.getSnapshot().matches({ on: 'following' })).toBe(true)
    tabs.host(thread('c'))
    expect(tabs.ids()).toContain('thread:c')
  })

  it('stops waiting for a navigation the Host never finishes', () => {
    vi.useFakeTimers()
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.host(thread('b'))
    tabs.actor.send({ type: 'tab.select', tabId: 'thread:a' })
    expect(tabs.actor.getSnapshot().matches({ on: 'navigating' })).toBe(true)
    vi.advanceTimersByTime(2_000)
    expect(tabs.actor.getSnapshot().matches({ on: 'following' })).toBe(true)
  })

  it('activates the right neighbour when the active tab closes, and navigates there', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.host(thread('b'))
    tabs.host(thread('c'))
    tabs.actor.send({ type: 'tab.select', tabId: 'thread:b' })
    tabs.host(thread('b'))
    tabs.actor.send({ type: 'tab.close', tabId: 'thread:b' })
    expect(tabs.ids()).toEqual(['thread:a', 'thread:c'])
    expect(tabs.set().activeTabId).toBe('thread:c')
    expect(tabs.navigated.at(-1)).toEqual(thread('c'))
  })

  it('closes other tabs and tabs to the right, keeping pinned ones', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    for (const id of ['a', 'b', 'c', 'd']) tabs.host(thread(id))
    tabs.actor.send({ type: 'tab.togglePin', tabId: 'thread:d' })
    expect(tabs.ids()).toEqual(['thread:d', 'thread:a', 'thread:b', 'thread:c'])
    tabs.actor.send({ type: 'tab.closeToRight', tabId: 'thread:a' })
    expect(tabs.ids()).toEqual(['thread:d', 'thread:a'])
    tabs.host(thread('e'))
    tabs.actor.send({ type: 'tab.closeOthers', tabId: 'thread:e' })
    expect(tabs.ids()).toEqual(['thread:d', 'thread:e'])
  })

  it('keeps pinned tabs a group at the start when reordering', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    for (const id of ['a', 'b', 'c']) tabs.host(thread(id))
    tabs.actor.send({ type: 'tab.togglePin', tabId: 'thread:a' })
    tabs.actor.send({ type: 'tab.move', tabId: 'thread:c', toIndex: 0 })
    expect(tabs.ids()).toEqual(['thread:a', 'thread:c', 'thread:b'])
    tabs.actor.send({ type: 'tab.move', tabId: 'thread:c', toIndex: 9 })
    expect(tabs.ids()).toEqual(['thread:a', 'thread:b', 'thread:c'])
  })

  it('jumps to a tab by position and cycles with wrap-around', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    for (const id of ['a', 'b', 'c']) tabs.host(thread(id))
    tabs.actor.send({ type: 'tab.activateIndex', index: 0 })
    expect(tabs.set().activeTabId).toBe('thread:a')
    tabs.host(thread('a'))
    tabs.actor.send({ type: 'tab.activateIndex', index: -1 })
    expect(tabs.set().activeTabId).toBe('thread:c')
    tabs.host(thread('c'))
    tabs.actor.send({ type: 'tab.cycle', direction: 1 })
    expect(tabs.set().activeTabId).toBe('thread:a')
    tabs.host(thread('a'))
    tabs.actor.send({ type: 'tab.cycle', direction: -1 })
    expect(tabs.set().activeTabId).toBe('thread:c')
  })

  it('keeps one tab set per project and switches with the thread shown', () => {
    const tabs = start({ preferences: { openMode: 'new', persistence: 'project' } })
    tabs.enable()
    tabs.host(thread('a'), 'project-1')
    tabs.host(panel('jujutsu'))
    tabs.host(thread('b'), 'project-2')
    expect(tabs.ids()).toEqual(['thread:b'])
    tabs.host(thread('a'), 'project-1')
    expect(tabs.ids()).toEqual(['thread:a', 'panel:jujutsu'])
  })

  it('shares one tab set across projects in global mode', () => {
    const tabs = start({ preferences: { openMode: 'new', persistence: 'global' } })
    tabs.enable()
    tabs.host(thread('a'), 'project-1')
    tabs.host(thread('b'), 'project-2')
    expect(tabs.ids()).toEqual(['thread:a', 'thread:b'])
  })

  it('persists every change and restores the saved active tab when the Host opens on nothing', () => {
    const first = start({ preferences: { openMode: 'new' } })
    first.enable()
    first.host(thread('a'), 'project-1')
    first.host(thread('b'), 'project-1')
    first.actor.send({ type: 'tab.select', tabId: 'thread:a' })
    first.host(thread('a'), 'project-1')
    const saved = first.saved.at(-1) ?? null
    expect(saved?.lastProjectKey).toBe('project:project-1')

    const second = start({ preferences: { openMode: 'new' }, persisted: saved })
    second.enable()
    second.host(null)
    expect(second.ids()).toEqual(['thread:a', 'thread:b'])
    expect(second.navigated).toEqual([thread('a')])
  })

  it('drops tabs of threads that no longer exist', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.host(thread('b'))
    tabs.actor.send({ type: 'threads.missing', sessionIds: ['a'] })
    expect(tabs.ids()).toEqual(['thread:b'])
  })

  it('ignores the Host while disabled and adopts its view when enabled again', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.actor.send({ type: 'preferences.changed', preferences: { ...tabs.preferences, enabled: false } })
    tabs.host(thread('b'))
    expect(tabs.ids()).toEqual(['thread:a'])
    tabs.enable()
    expect(tabs.ids()).toEqual(['thread:a', 'thread:b'])
    expect(tabs.set().activeTabId).toBe('thread:b')
  })

  it('leaves no tab active on the New thread screen', () => {
    const tabs = start({ preferences: { openMode: 'new' } })
    tabs.enable()
    tabs.host(thread('a'))
    tabs.host(null)
    expect(tabs.set()).toMatchObject({ activeTabId: null })
    expect(tabs.ids()).toEqual(['thread:a'])
  })
})
