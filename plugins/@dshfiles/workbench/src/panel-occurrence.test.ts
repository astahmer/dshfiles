// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { panelOccurrence, panelOccurrenceStorageKey } from './panel-occurrence.js'

afterEach(() => localStorage.clear())

describe('panel occurrence', () => {
  it('joins the Workbench scope so two project scopes never share a key', () => {
    expect(panelOccurrence({ panelId: 'tab/a', scopeKey: 'project:/work/a' })).not.toBe(panelOccurrence({ panelId: 'tab/a', scopeKey: 'project:/work/b' }))
    expect(panelOccurrence({ panelId: 'tab/a' })).toBe('project:none/tab/a')
    expect(panelOccurrenceStorageKey({ base: 'plugin.view', panelId: 'tab/a', scopeKey: 'project:/work/a' })).toBe(
      'plugin.view/panel/project%3A%2Fwork%2Fa%2Ftab%2Fa',
    )
  })

  it('seeds a new key from the first saved legacy key and never overwrites it', () => {
    localStorage.setItem('plugin.view', '"base"')
    const first = panelOccurrenceStorageKey({
      base: 'plugin.view',
      panelId: 'tab/a',
      scopeKey: 'project:/work/a',
      legacyKeys: ['plugin.view/panel/tab%2Fa', 'plugin.view'],
    })
    expect(localStorage.getItem(first)).toBe('"base"')
    localStorage.setItem(first, '"changed"')
    localStorage.setItem('plugin.view/panel/tab%2Fa', '"per-panel"')
    panelOccurrenceStorageKey({ base: 'plugin.view', panelId: 'tab/a', scopeKey: 'project:/work/a' })
    expect(localStorage.getItem(first)).toBe('"changed"')
    const second = panelOccurrenceStorageKey({ base: 'plugin.view', panelId: 'tab/a', scopeKey: 'project:/work/b' })
    expect(localStorage.getItem(second)).toBe('"per-panel"')
  })
})
