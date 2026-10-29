import { createActor } from '@dshfiles/plugin-ui/machine'
import type { WorkbenchTab } from '@dshfiles/workbench/tabs'
import { describe, expect, it, vi } from 'vitest'
import { createMainTabsService } from './main-tabs-service.js'
import { DEFAULT_TAB_PREFERENCES, tabsMachine } from './tabs-machine.js'
import { createWorkbenchTabsActions } from './workbench-tab-actions.js'
import { createWorkbenchTabsPublication } from './workbench-tabs-publication.js'

const start = () => {
  const actor = createActor(tabsMachine, { input: { ports: { navigate: vi.fn(() => true), save: vi.fn() }, persisted: null } }).start()
  actor.send({ type: 'preferences.changed', preferences: DEFAULT_TAB_PREFERENCES })
  const enabled = (): boolean => actor.getSnapshot().matches('on')
  const currentSet = () => actor.getSnapshot().context.sets[actor.getSnapshot().context.scopeKey]
  const actions = createWorkbenchTabsActions({
    enabled,
    currentSet,
    send: event => actor.send(event),
    reselect: vi.fn(),
    threadAside: vi.fn(() => false),
    panelAside: vi.fn(() => false),
    renameThread: vi.fn(async () => undefined),
    startSession: vi.fn(),
  })
  const publication = createWorkbenchTabsPublication(actions)
  const publish = (): void => {
    const set = currentSet()
    const tabs = (set?.tabs ?? []).map((tab): WorkbenchTab => {
      const base = {
        id: tab.id,
        target: tab.target,
        title: tab.id,
        pinned: tab.pinned,
        preview: tab.preview,
        active: tab.id === set?.activeTabId,
        available: true,
        status: null,
      }
      if (tab.target.kind === 'thread') return { ...base, kind: 'thread', sessionId: tab.target.sessionId }
      if (tab.target.kind === 'panel') return { ...base, kind: 'panel', panelId: tab.target.panelId }
      return { ...base, kind: 'start' }
    })
    publication.update({ enabled: enabled(), scopeKey: actor.getSnapshot().context.scopeKey, activeTabId: set?.activeTabId ?? null, tabs }, () => null)
  }
  const service = createMainTabsService({
    provider: publication.provider,
    enabled,
    currentSet,
    isListedThread: sessionId => sessionId !== 'unlisted',
    canReopen: () => actor.getSnapshot().can({ type: 'tab.reopenClosed' }),
    send: event => actor.send(event),
  })
  return { actor, currentSet, publish, service }
}

describe('main tabs service', () => {
  it('opens, focuses and closes tabs on the strip actor and lists what the strip shows', () => {
    const tabs = start()
    const listener = vi.fn()
    tabs.service.tabs.subscribe(listener)
    expect(tabs.service.open({ kind: 'thread', sessionId: 'a' }, { newTab: true })).toBe('thread:a')
    expect(tabs.service.open({ kind: 'panel', panelId: 'editor', scope: 'tab:1' }, { newTab: true, title: 'Editor · repo' })).toBe('panel:editor#tab:1')
    tabs.publish()
    expect(listener).toHaveBeenCalledOnce()
    expect(tabs.service.tabs.get().map(tab => [tab.id, tab.active])).toEqual([
      ['thread:a', false],
      ['panel:editor#tab:1', true],
    ])
    expect(tabs.currentSet()?.tabs[1]?.title).toBe('Editor · repo')

    expect(tabs.service.focus('thread:a')).toBe(true)
    expect(tabs.currentSet()?.activeTabId).toBe('thread:a')
    expect(tabs.service.close('panel:editor#tab:1')).toBe(true)
    expect(tabs.currentSet()?.tabs.map(tab => tab.id)).toEqual(['thread:a'])
    tabs.actor.stop()
  })

  it('pins a tab and reopens the most recently closed tabs in reverse order', () => {
    const tabs = start()
    tabs.service.open({ kind: 'thread', sessionId: 'a' }, { newTab: true })
    tabs.service.open({ kind: 'panel', panelId: 'editor', scope: 'tab:1' }, { newTab: true, title: 'Editor · repo' })
    tabs.service.open({ kind: 'thread', sessionId: 'b' }, { newTab: true })
    expect(tabs.service.pin('thread:b', true)).toBe(true)
    expect(tabs.currentSet()?.tabs.map(tab => [tab.id, tab.pinned])).toEqual([
      ['thread:b', true],
      ['thread:a', false],
      ['panel:editor#tab:1', false],
    ])
    expect(tabs.service.pin('thread:missing', true)).toBe(false)

    expect(tabs.service.reopenClosed()).toBe(false)
    tabs.service.close('panel:editor#tab:1')
    tabs.service.close('thread:a')
    expect(tabs.currentSet()?.tabs.map(tab => tab.id)).toEqual(['thread:b'])
    expect(tabs.service.reopenClosed()).toBe(true)
    expect(tabs.currentSet()?.activeTabId).toBe('thread:a')
    expect(tabs.service.reopenClosed()).toBe(true)
    expect(tabs.currentSet()?.tabs.find(tab => tab.id === 'panel:editor#tab:1')?.title).toBe('Editor · repo')
    expect(tabs.service.reopenClosed()).toBe(false)
    tabs.actor.stop()
  })

  it('declines an unlisted thread and tabs it does not have', () => {
    const tabs = start()
    expect(tabs.service.open({ kind: 'thread', sessionId: 'unlisted' })).toBeUndefined()
    expect(tabs.service.focus('thread:missing')).toBe(false)
    expect(tabs.service.close('thread:missing')).toBe(false)
    expect(tabs.currentSet()?.tabs ?? []).toEqual([])
    tabs.actor.stop()
  })

  it('lists nothing and opens nothing while tabs are switched off', () => {
    const tabs = start()
    tabs.service.open({ kind: 'thread', sessionId: 'a' }, { newTab: true })
    tabs.actor.send({ type: 'preferences.changed', preferences: { ...DEFAULT_TAB_PREFERENCES, enabled: false } })
    tabs.publish()
    expect(tabs.service.tabs.get()).toEqual([])
    expect(tabs.service.open({ kind: 'thread', sessionId: 'b' })).toBeUndefined()
    expect(tabs.service.focus('thread:a')).toBe(false)
    tabs.actor.stop()
  })
})
