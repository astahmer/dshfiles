// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { panelStores } from './panel-stores.js'

describe('trace panel presentation stores', () => {
  beforeEach(() => localStorage.clear())
  it('isolates and restores each occurrence without changing the native view', () => {
    const first = panelStores('tab/first')
    const second = panelStores('tab/second')
    const native = panelStores()
    first.traces.set({ ...first.traces.get(), tab: 'logs', search: 'first' })
    first.logs.set({ ...first.logs.get(), search: 'log search' })
    first.board.set('jobs')
    expect(second.traces.get().search).toBe('')
    expect(second.logs.get().search).toBe('')
    expect(second.board.get()).not.toBe('jobs')
    expect(native.traces.get().search).toBe('')
    const restored = panelStores('tab/first')
    expect(restored.traces.get().search).toBe('first')
    expect(restored.logs.get().search).toBe('log search')
    expect(restored.board.get()).toBe('jobs')
  })

  it('keeps the same semantic tab apart in two Workbench project scopes', () => {
    const projectA = panelStores('tab/panel:traces', 'project:/work/a')
    const projectB = panelStores('tab/panel:traces', 'project:/work/b')
    projectA.traces.set({ ...projectA.traces.get(), tab: 'boards', search: 'a' })
    projectA.board.set('jobs')
    expect(projectB.traces.get().search).toBe('')
    expect(projectB.traces.get().tab).toBe('traces')
    expect(projectB.board.get()).not.toBe('jobs')
    expect(panelStores('tab/panel:traces', 'project:/work/a').traces.get().search).toBe('a')
  })
})
