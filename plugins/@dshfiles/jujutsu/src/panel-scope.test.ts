// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { activeJujutsuScope, DEFAULT_PANEL_SCOPE, DOCK_PANEL_SCOPE, JUJUTSU_PANEL_ID, PanelScopes } from './panel-scope.js'

const PANEL_SCOPE_EVENT = 'dshfiles:panel-scope'
const PANEL_TAB_TITLE_EVENT = 'dshfiles:panel-tab-title'
const OPEN_PANEL_TAB_EVENT = 'dshfiles:open-panel-tab'

interface PanelEventDetail {
  readonly panelId?: string
  readonly scope?: string | null
  readonly title?: string
}

// SAFETY: these tests dispatch the events themselves, so the detail is the shape they wrote.
const detailOf = (event: Event): PanelEventDetail | undefined => (event instanceof CustomEvent ? (event.detail as PanelEventDetail) : undefined)

afterEach(() => {
  localStorage.clear()
  activeJujutsuScope.set(DEFAULT_PANEL_SCOPE)
})

describe('panel scopes', () => {
  it('reads only its own panel scope, and falls back to the panel default for an unscoped tab', () => {
    const own = (scope: string | null) => new CustomEvent(PANEL_SCOPE_EVENT, { detail: { panelId: JUJUTSU_PANEL_ID, scope } })

    expect(PanelScopes.read(own('tab:one'))).toBe('tab:one')
    expect(PanelScopes.read(own(null))).toBe(DEFAULT_PANEL_SCOPE)
    expect(PanelScopes.read(new CustomEvent(PANEL_SCOPE_EVENT, { detail: { panelId: 'other', scope: 'tab:one' } }))).toBeUndefined()
    expect(PanelScopes.read(new CustomEvent(PANEL_SCOPE_EVENT, { detail: { panelId: JUJUTSU_PANEL_ID } }))).toBeUndefined()
    expect(PanelScopes.read(new Event(PANEL_SCOPE_EVENT))).toBeUndefined()
  })

  it('follows the scope a tab announces until another one does', () => {
    const stop = PanelScopes.listen()
    window.dispatchEvent(new CustomEvent(PANEL_SCOPE_EVENT, { detail: { panelId: JUJUTSU_PANEL_ID, scope: 'tab:one' } }))
    expect(activeJujutsuScope.get()).toBe('tab:one')
    window.dispatchEvent(new CustomEvent(PANEL_SCOPE_EVENT, { detail: { panelId: 'other', scope: 'tab:two' } }))
    expect(activeJujutsuScope.get()).toBe('tab:one')
    window.dispatchEvent(new CustomEvent(PANEL_SCOPE_EVENT, { detail: { panelId: JUJUTSU_PANEL_ID, scope: null } }))
    expect(activeJujutsuScope.get()).toBe(DEFAULT_PANEL_SCOPE)
    stop()
  })

  it('opens a thread scope on its own project, a remembered repository first, and the panel default on its last pick', () => {
    const thread = PanelScopes.thread('session-1')

    expect(PanelScopes.initialPath({ scope: thread, defaultPath: '/work/project', legacyPath: '/work/other' })).toBe('/work/project')
    expect(PanelScopes.initialPath({ scope: DEFAULT_PANEL_SCOPE, defaultPath: null, legacyPath: '/work/other' })).toBe('/work/other')
    expect(PanelScopes.initialPath({ scope: DOCK_PANEL_SCOPE, defaultPath: null, legacyPath: '/work/other' })).toBe('/work/other')
    expect(PanelScopes.initialPath({ scope: thread, defaultPath: null, legacyPath: '/work/other' })).toBe('')
    expect(PanelScopes.initialPath({ scope: PanelScopes.newMainTab(), defaultPath: null, legacyPath: '/work/other' })).toBe('')

    PanelScopes.remember(thread, { path: '/work/elsewhere', view: 'source' })

    expect(PanelScopes.initialPath({ scope: thread, defaultPath: '/work/project', legacyPath: '/work/other' })).toBe('/work/elsewhere')
    expect(PanelScopes.persisted(thread).view).toBe('source')
  })

  it('replaces a remembered repository that was removed with the owning project', () => {
    const scope = PanelScopes.thread('removed-workspace')
    PanelScopes.remember(scope, { path: '/threads/removed-workspace' })

    expect(
      PanelScopes.initialPath({
        scope,
        defaultPath: '/work/dshfiles',
        legacyPath: '/work/other',
        registeredPaths: ['/work/dshfiles'],
      }),
    ).toBe('/work/dshfiles')
  })

  it('keeps a panel request repository for the scope it was made for', () => {
    const scope = PanelScopes.thread('session-2')

    PanelScopes.rememberPath(scope, '/work/referenced')

    expect(PanelScopes.initialPath({ scope, defaultPath: '/work/project', legacyPath: '' })).toBe('/work/referenced')
    expect(PanelScopes.readMemory(scope, 'path')).toBe('/work/referenced')
  })

  it('starts a scope on what this page already showed it, else the caller default', () => {
    const scope = PanelScopes.newMainTab()
    PanelScopes.writeMemory(scope, 'textFilter', 'fix')

    expect(PanelScopes.rememberedState(scope, 'textFilter', () => '')).toBe('fix')
    expect(PanelScopes.rememberedState(scope, 'authorFilter', () => '')).toBe('')
  })

  it('names a scoped tab after the repository it shows, and the panel default when it shows none', () => {
    expect(PanelScopes.title('/Users/me/dev/dshfiles')).toBe('Jujutsu · dshfiles')
    expect(PanelScopes.title('/Users/me/dev/dshfiles/')).toBe('Jujutsu · dshfiles')
    expect(PanelScopes.title(null)).toBe('Jujutsu')

    const titles: unknown[] = []
    const onTitle = (event: Event): void => {
      titles.push(detailOf(event))
    }
    window.addEventListener(PANEL_TAB_TITLE_EVENT, onTitle)

    PanelScopes.publishTitle(DEFAULT_PANEL_SCOPE, '/work/project')
    PanelScopes.publishTitle('tab:one', '/work/project')
    expect(titles).toEqual([{ panelId: JUJUTSU_PANEL_ID, scope: 'tab:one', title: 'Jujutsu · project' }])
    window.removeEventListener(PANEL_TAB_TITLE_EVENT, onTitle)
  })

  it('asks for another tab seeded with the repository on screen', () => {
    const scope = PanelScopes.newMainTab()
    const requests: unknown[] = []
    const onRequest = (event: Event): void => {
      requests.push(detailOf(event))
    }
    window.addEventListener(OPEN_PANEL_TAB_EVENT, onRequest)

    PanelScopes.requestTab({ scope, path: '/work/project' })

    expect(requests).toEqual([{ panelId: JUJUTSU_PANEL_ID, scope, title: 'Jujutsu · project' }])
    expect(PanelScopes.persisted(scope).path).toBe('/work/project')
    window.removeEventListener(OPEN_PANEL_TAB_EVENT, onRequest)
  })
})
