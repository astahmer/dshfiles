// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { boardColumnsFor, panelPreferences } from './panel-preferences.js'
import { BACKLOG_PANEL_ID } from './panel-draft.js'

afterEach(() => localStorage.clear())
beforeEach(() => localStorage.clear())
beforeAll(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))

describe('panel presentation preferences', () => {
  it('retains legacy preferences for the original panel without sharing them with new occurrences', () => {
    const legacy = panelPreferences(undefined)
    legacy.set({ ...legacy.get(), view: 'board' })
    expect(panelPreferences(BACKLOG_PANEL_ID).get().view).toBe('board')
    expect(panelPreferences('new-occurrence').get().view).toBe('feed')
  })

  it('keeps board columns independent', () => {
    const first = boardColumnsFor('first')
    first.set({ ...first.get(), hidden: ['done'] })
    expect(boardColumnsFor('first').get().hidden).toEqual(['done'])
    expect(boardColumnsFor('second').get().hidden).toEqual([])
  })

  it('keeps the same panel apart in two simultaneous Workbench project scopes', () => {
    const projectA = panelPreferences('panel/first', 'project:/work/a')
    const projectB = panelPreferences('panel/first', 'project:/work/b')
    projectA.set({ ...projectA.get(), view: 'board' })
    expect(projectB.get().view).toBe('feed')
    expect(panelPreferences('panel/first', 'project:/work/a').get().view).toBe('board')
    const columnsA = boardColumnsFor('panel/first', 'project:/work/a')
    columnsA.set({ ...columnsA.get(), hidden: ['done'] })
    expect(boardColumnsFor('panel/first', 'project:/work/b').get().hidden).toEqual([])
  })

  it('starts each scope from the preference the panel saved before scopes', () => {
    localStorage.setItem('dshfiles.backlog.view.v2/panel/panel%2Ffirst', JSON.stringify({ view: 'board', groupBy: 'status', showDormant: false }))
    expect(panelPreferences('panel/first', 'project:/work/a').get().view).toBe('board')
    expect(panelPreferences('panel/first', 'project:/work/b').get().view).toBe('board')
  })

  it('isolates simultaneous panels and restores each after remount', async () => {
    const first = panelPreferences('panel/first')
    const second = panelPreferences('panel/second')
    const seen = new Map<string, ReturnType<typeof first.get>>()
    const Panel = (props: { id: string; store: typeof first }) => {
      seen.set(props.id, props.store.useValue())
      return null
    }
    const root = createRoot(document.createElement('div'))
    const mount = () =>
      root.render(
        <>
          <Panel id="first" store={first} />
          <Panel id="second" store={second} />
        </>,
      )
    await act(async () => mount())
    await act(async () => first.set({ ...first.get(), view: 'board', showDormant: true }))
    expect(seen.get('first')?.view).toBe('board')
    expect(seen.get('second')?.view).toBe('feed')
    expect(seen.get('second')?.showDormant).toBe(false)
    await act(async () => root.unmount())
    expect(panelPreferences('panel/first').get().view).toBe('board')
    expect(panelPreferences('panel/second').get().view).toBe('feed')
  })
})
