import { createActor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectiveTabPreferences } from './tab-preferences-policy.js'
import { tabsMachine, type PersistedTabs, type TabPreferences } from './tabs-machine.js'
import type { HostTarget } from '@dshfiles/workbench/tabs'

const thread = (sessionId: string): HostTarget => ({ kind: 'thread', sessionId })
const preferences: TabPreferences = { enabled: true, maxTabs: 12, openMode: 'preview', persistence: 'project' }
const initialTabs = (): PersistedTabs => ({
  lastProjectKey: 'project:a',
  sets: {
    'project:a': {
      tabs: [
        { id: 'thread:b', target: thread('b'), pinned: true, preview: false, usedAt: 1 },
        { id: 'thread:a', target: thread('a'), pinned: false, preview: false, usedAt: 2 },
      ],
      activeTabId: 'thread:a',
    },
    'project:b': {
      tabs: [{ id: 'thread:dormant', target: thread('dormant'), pinned: false, preview: false, usedAt: 3 }],
      activeTabId: 'thread:dormant',
    },
  },
})
const actors: { stop: () => void }[] = []

// Real actor and derived surface policy. Only its documented native navigation
// and storage ports are replaced; Host ACKs carry two distinct owning projects.
const start = (
  persisted: PersistedTabs | null = initialTabs(),
  mode: 'workbench' | 'native' = 'workbench',
  initialHost?: { readonly sessionId: string; readonly projectId: string },
) => {
  const navigate = vi.fn(() => true)
  const saved: PersistedTabs[] = []
  const actor = createActor(tabsMachine, { input: { persisted, ports: { navigate, save: tabs => saved.push(tabs) } } }).start()
  actors.push(actor)
  if (initialHost !== undefined) actor.send({ type: 'host.navigated', target: thread(initialHost.sessionId), projectId: initialHost.projectId })
  actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences(preferences, mode) })
  const context = () => actor.getSnapshot().context
  const set = () => context().sets[context().scopeKey]
  const ids = () => set()?.tabs.map(tab => tab.id) ?? []
  const host = (sessionId: string | null, projectId: string | null) =>
    actor.send({ type: 'host.navigated', target: sessionId === null ? null : thread(sessionId), projectId })
  return { actor, navigate, saved, context, set, ids, host }
}

afterEach(() => {
  actors.splice(0).forEach(actor => actor.stop())
})

describe('Workbench scene scope ownership', () => {
  it('keeps order pins targets and inactive ActorStart through cross-project existing-tab selection and ACK cycles', () => {
    const tabs = start()
    tabs.host('a', 'a')
    tabs.actor.send({ type: 'tab.new' })
    tabs.actor.send({ type: 'tab.select', tabId: 'thread:a' })
    const targets = tabs.set()?.tabs.map(tab => tab.target)
    const dormant = tabs.context().sets['project:b']

    for (const sessionId of ['b', 'a', 'b', 'a']) {
      tabs.actor.send({ type: 'tab.select', tabId: `thread:${sessionId}` })
      expect(tabs.context().scopeKey).toBe('project:a')
      tabs.host(sessionId, sessionId)
      expect(tabs.context()).toMatchObject({ scopeKey: 'project:a', lastProjectKey: 'project:a', hostProjectId: sessionId, pendingTarget: null })
      expect(tabs.ids()).toEqual(['thread:b', 'thread:a', 'start'])
      expect(tabs.set()?.activeTabId).toBe(`thread:${sessionId}`)
      expect(tabs.set()?.tabs.map(tab => tab.pinned)).toEqual([true, false, false])
      tabs.set()?.tabs.forEach((tab, index) => expect(tab.target).toBe(targets?.[index]))
      expect(tabs.context().sets['project:b']).toBe(dormant)
    }
  })

  it('keeps the scene for an external open of an existing other-project tab', () => {
    const tabs = start()
    tabs.host('a', 'a')
    const dormant = tabs.context().sets['project:b']
    tabs.actor.send({ type: 'tab.open', target: thread('b'), newTab: false })
    tabs.host('b', 'b')
    expect(tabs.context().scopeKey).toBe('project:a')
    expect(tabs.ids()).toEqual(['thread:b', 'thread:a'])
    expect(tabs.set()?.activeTabId).toBe('thread:b')
    expect(tabs.context().sets['project:b']).toBe(dormant)
    expect(tabs.navigate).toHaveBeenLastCalledWith(thread('b'))
  })

  it('closes the active tab into its other-project neighbor without adopting another scene', () => {
    const tabs = start()
    tabs.host('a', 'a')
    tabs.actor.send({ type: 'tab.close', tabId: 'thread:a' })
    expect(tabs.navigate).toHaveBeenLastCalledWith(thread('b'))
    tabs.host('b', 'b')
    expect(tabs.context().scopeKey).toBe('project:a')
    expect(tabs.ids()).toEqual(['thread:b'])
    expect(tabs.set()?.tabs[0]).toMatchObject({ pinned: true, preview: false })
    expect(tabs.set()?.activeTabId).toBe('thread:b')
  })

  it('reloads the saved anchor when native current belongs to another project without merging dormant sets', () => {
    const first = start()
    first.host('a', 'a')
    first.actor.send({ type: 'tab.select', tabId: 'thread:b' })
    first.host('b', 'b')
    const saved = first.saved.at(-1)
    if (saved === undefined) throw new Error('Actor did not persist')
    // Boot reports native current before settings arrive, as the client can do.
    const second = start(saved, 'workbench', { sessionId: 'b', projectId: 'b' })
    expect(second.context()).toMatchObject({ scopeKey: 'project:a', lastProjectKey: 'project:a', hostProjectId: 'b' })
    expect(second.ids()).toEqual(['thread:b', 'thread:a'])
    expect(second.set()?.activeTabId).toBe('thread:b')
    expect(second.context().sets['project:b']).toBe(saved.sets['project:b'])
  })

  it('treats unsolicited Host navigation and a blank main view as subject changes, not scene changes', () => {
    const tabs = start()
    tabs.host('a', 'a')
    tabs.host('c', 'c')
    tabs.host(null, 'b')
    expect(tabs.context()).toMatchObject({ scopeKey: 'project:a', lastProjectKey: 'project:a', hostProjectId: 'b', hostTarget: null })
    expect(tabs.ids()).toEqual(['thread:b', 'thread:a', 'thread:c'])
    expect(tabs.set()?.activeTabId).toBeNull()
  })

  it('keeps a fresh project:none window anchored when its first known Host project arrives', () => {
    const tabs = start(null)
    tabs.host('a', 'a')
    tabs.actor.send({ type: 'tab.new' })
    tabs.actor.send({ type: 'tab.select', tabId: 'thread:a' })
    tabs.actor.send({ type: 'tab.open', target: thread('b'), newTab: false })
    tabs.host('b', 'b')
    expect(tabs.context()).toMatchObject({ scopeKey: 'project:none', lastProjectKey: null, hostProjectId: 'b' })
    expect(tabs.ids()).toEqual(['thread:a', 'thread:b', 'start'])
  })

  it('still applies an explicit persistence preference change without overwriting either saved scene', () => {
    const tabs = start()
    tabs.host('a', 'a')
    const project = tabs.set()
    tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences({ ...preferences, persistence: 'global' }, 'workbench') })
    expect(tabs.context().scopeKey).toBe('global')
    expect(tabs.context().sets['project:a']).toBe(project)
    tabs.host('b', 'b')
    expect(tabs.context().scopeKey).toBe('global')
    tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences(preferences, 'workbench') })
    expect(tabs.context().scopeKey).toBe('project:a')
    expect(tabs.set()).toEqual(project)
    tabs.set()?.tabs.forEach((tab, index) => expect(tab).toBe(project?.tabs[index]))
    expect(tabs.context().sets['global']?.tabs.map(tab => tab.id)).toEqual(['thread:b'])
  })

  it('retains native project-follow behavior and releases the anchor when leaving Workbench', () => {
    for (const initialMode of ['native', 'workbench'] as const) {
      const tabs = start(initialTabs(), initialMode)
      tabs.host('a', 'a')
      if (initialMode === 'workbench') tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences(preferences, 'native') })
      tabs.actor.send({ type: 'tab.select', tabId: 'thread:b' })
      tabs.host('b', 'b')
      expect(tabs.context()).toMatchObject({ scopeKey: 'project:b', lastProjectKey: 'project:b', hostProjectId: 'b' })
      expect(tabs.ids()).toEqual(['thread:dormant', 'thread:b'])
      expect(tabs.context().sets['project:a']?.tabs.map(tab => tab.id)).toEqual(['thread:b', 'thread:a'])
    }
  })
})
