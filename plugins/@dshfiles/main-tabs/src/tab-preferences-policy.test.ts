import { createActor } from '@dshfiles/plugin-ui/machine'
import { afterEach, describe, expect, it } from 'vitest'
import { effectiveTabPreferences } from './tab-preferences-policy.js'
import { tabsMachine, type HostTarget, type PersistedTabs, type TabPreferences } from './tabs-machine.js'

const legacyPreferences: TabPreferences = Object.freeze({ enabled: false, openMode: 'preview', maxTabs: 12, persistence: 'project' })
const thread = (sessionId: string): HostTarget => ({ kind: 'thread', sessionId })
const actors: { stop: () => void }[] = []

const start = (persisted: PersistedTabs | null = null) => {
  const saved: PersistedTabs[] = []
  const actor = createActor(tabsMachine, { input: { ports: { navigate: () => true, save: tabs => saved.push(tabs) }, persisted } }).start()
  actors.push(actor)
  const set = () => {
    const context = actor.getSnapshot().context
    return context.sets[context.scopeKey]
  }
  const host = (sessionId: string): void => actor.send({ type: 'host.navigated', target: thread(sessionId), projectId: 'one' })
  return { actor, saved, set, host, ids: () => set()?.tabs.map(tab => tab.id) ?? [] }
}

afterEach(() => {
  actors.splice(0).forEach(actor => actor.stop())
})

describe('effectiveTabPreferences', () => {
  it('enables Workbench conversation retention without mutating saved native preferences', () => {
    const preferences: TabPreferences = Object.freeze({ ...legacyPreferences, maxTabs: 23, persistence: 'global' })
    expect(effectiveTabPreferences(preferences, 'workbench')).toEqual({
      enabled: true,
      openMode: 'preview',
      maxTabs: 23,
      persistence: 'global',
      keepConversations: true,
      keepScope: true,
    })
    expect(preferences).toEqual({ enabled: false, openMode: 'preview', maxTabs: 23, persistence: 'global' })
  })

  it.each(['preview', 'new', 'replace'] as const)('returns the exact saved native preferences for %s mode', openMode => {
    const preferences = { ...legacyPreferences, openMode }
    expect(effectiveTabPreferences(preferences, 'native')).toBe(preferences)
  })

  it.each([false, true])('keeps A and B as fixed Workbench tabs with legacy enabled=%s and preview mode', enabled => {
    const tabs = start()
    tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences({ ...legacyPreferences, enabled }, 'workbench') })
    tabs.host('a')
    tabs.actor.send({ type: 'tab.open', target: thread('b'), newTab: false })
    tabs.host('b')

    expect(tabs.actor.getSnapshot().matches('on')).toBe(true)
    expect(tabs.ids()).toEqual(['thread:a', 'thread:b'])
    expect(tabs.set()?.tabs.map(tab => tab.preview)).toEqual([false, false])
    expect(tabs.saved.at(-1)?.sets['project:none']?.tabs.map(tab => tab.id)).toEqual(['thread:a', 'thread:b'])
  })

  it('keeps Workbench conversations while preserving panel preview replacement', () => {
    const tabs = start()
    tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences({ ...legacyPreferences, enabled: true }, 'workbench') })
    tabs.host('a')
    tabs.host('b')
    tabs.actor.send({ type: 'host.navigated', target: { kind: 'panel', panelId: 'jujutsu' }, projectId: 'one' })
    tabs.actor.send({ type: 'host.navigated', target: { kind: 'panel', panelId: 'usage' }, projectId: 'one' })

    expect(tabs.ids()).toEqual(['thread:a', 'thread:b', 'panel:usage'])
    expect(tabs.set()?.tabs.map(tab => tab.preview)).toEqual([false, false, true])
  })

  it.each(['preview', 'replace'] as const)('protects restored legacy conversation previews from panel %s replacement', openMode => {
    const restored = { id: 'thread:a', target: thread('a'), pinned: false, preview: true, usedAt: 1 }
    const tabs = start({ lastProjectKey: 'project:one', sets: { 'project:one': { tabs: [restored], activeTabId: restored.id } } })
    tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences({ ...legacyPreferences, openMode }, 'workbench') })
    tabs.actor.send({ type: 'host.navigated', target: { kind: 'panel', panelId: 'jujutsu' }, projectId: 'one' })
    expect(tabs.ids()).toEqual(['thread:a', 'panel:jujutsu'])

    tabs.actor.send({ type: 'host.navigated', target: { kind: 'panel', panelId: 'editor' }, projectId: 'one' })
    expect(tabs.ids()).toEqual(['thread:a', 'panel:editor'])
    expect(tabs.set()?.tabs[0]).toEqual(restored)
    expect(tabs.saved.at(-1)?.sets['project:one']?.tabs[0]).toEqual(restored)
  })

  it.each(['preview', 'replace'] as const)('keeps fixed identities and reopens the current thread after close-all with %s preferences', openMode => {
    const tabs = start()
    tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences({ ...legacyPreferences, openMode }, 'workbench') })
    tabs.host('a')
    tabs.actor.send({ type: 'tab.open', target: thread('b'), newTab: false })
    tabs.host('b')
    const originalA = tabs.set()?.tabs.find(tab => tab.id === 'thread:a')?.target
    const originalB = tabs.set()?.tabs.find(tab => tab.id === 'thread:b')?.target
    tabs.actor.send({ type: 'tab.open', target: thread('a'), newTab: false })
    expect(tabs.ids()).toEqual(['thread:a', 'thread:b'])
    expect(tabs.set()?.activeTabId).toBe('thread:a')
    expect(tabs.set()?.tabs.map(tab => tab.target)).toEqual([thread('a'), thread('b')])
    expect(tabs.set()?.tabs[0]?.target).toBe(originalA)
    expect(tabs.set()?.tabs[1]?.target).toBe(originalB)
    tabs.host('a')
    tabs.actor.send({ type: 'tab.close', tabId: 'thread:b' })
    tabs.actor.send({ type: 'tab.close', tabId: 'thread:a' })
    expect(tabs.set()).toEqual({ tabs: [], activeTabId: null })
    expect(tabs.actor.getSnapshot().context.hostTarget).toEqual(thread('a'))
    // Same native current Session: no host.navigated event arrives. Explicit
    // sidebar open must still recreate exactly one fixed occurrence.
    tabs.actor.send({ type: 'tab.open', target: thread('a'), newTab: false })
    tabs.actor.send({ type: 'tab.open', target: thread('a'), newTab: false })
    expect(tabs.ids()).toEqual(['thread:a'])
    expect(tabs.set()?.tabs[0]).toMatchObject({ target: thread('a'), preview: false })
    tabs.actor.send({ type: 'tab.open', target: thread('b'), newTab: false })
    expect(tabs.ids()).toEqual(['thread:a', 'thread:b'])
    expect(tabs.set()?.tabs.every(tab => !tab.preview)).toBe(true)
  })

  it('leaves disabled standalone tabs disabled', () => {
    const tabs = start()
    tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences(legacyPreferences, 'native') })
    tabs.host('a')
    tabs.host('b')

    expect(tabs.actor.getSnapshot().matches('off')).toBe(true)
    expect(tabs.ids()).toEqual([])
    expect(tabs.saved).toEqual([])
  })

  it('preserves standalone preview replacement', () => {
    const tabs = start()
    tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences({ ...legacyPreferences, enabled: true }, 'native') })
    tabs.host('a')
    tabs.host('b')

    expect(tabs.ids()).toEqual(['thread:b'])
    expect(tabs.set()?.tabs[0]?.preview).toBe(true)
  })

  it('retains persisted project tabs and pins across native and Workbench mode changes', () => {
    const persisted: PersistedTabs = {
      lastProjectKey: 'project:one',
      sets: {
        'project:one': {
          tabs: [
            { id: 'thread:a', target: thread('a'), pinned: true, preview: false, usedAt: 1 },
            { id: 'thread:b', target: thread('b'), pinned: false, preview: true, usedAt: 2 },
          ],
          activeTabId: 'thread:b',
        },
        'project:two': { tabs: [{ id: 'thread:c', target: thread('c'), pinned: false, preview: false, usedAt: 3 }], activeTabId: 'thread:c' },
      },
    }
    const tabs = start(persisted)
    for (const mode of ['workbench', 'native', 'workbench'] as const) {
      tabs.actor.send({ type: 'preferences.changed', preferences: effectiveTabPreferences(legacyPreferences, mode) })
      expect(tabs.actor.getSnapshot().matches(mode === 'workbench' ? 'on' : 'off')).toBe(true)
      expect(tabs.actor.getSnapshot().context.sets).toEqual(persisted.sets)
      expect(tabs.actor.getSnapshot().context.lastProjectKey).toBe(persisted.lastProjectKey)
      expect(tabs.ids()).toEqual(['thread:a', 'thread:b'])
    }
    tabs.host('b')
    expect(tabs.saved.at(-1)?.sets['project:one']?.tabs.map(tab => tab.id)).toEqual(['thread:a', 'thread:b'])
    expect(tabs.saved.at(-1)?.sets['project:two']).toEqual(persisted.sets['project:two'])
  })
})
