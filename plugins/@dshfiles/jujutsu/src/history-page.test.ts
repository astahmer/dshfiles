import { describe, expect, it } from 'vitest'

import { HistoryPage } from './history-page.js'
import { PanelScopes } from './panel-scope.js'

describe('History and Source control pages', () => {
  it('carry the names the navigation uses, each with its own empty sentence', () => {
    expect(HistoryPage.titles).toEqual({ graph: 'History', source: 'Source control' })
    expect(HistoryPage.emptyTexts.graph).toBe('Choose a project above to see its history.')
    expect(HistoryPage.emptyTexts.source).toBe('Choose a project above to see its uncommitted changes.')
    expect(HistoryPage.emptyTexts.source).not.toContain('revision graph')
  })

  it('titles a tab after the page, not the plugin', () => {
    expect(PanelScopes.title('/work/dshfiles')).toBe('History · dshfiles')
    expect(PanelScopes.title(null)).toBe('History')
  })

  it('open on the current project, else the first registered project, never a thread workspace', () => {
    const projects = [
      { canonicalPath: '/work/sample-threads/thread-31057e', isJjWorkspace: true },
      { canonicalPath: '/work/sample' },
      { canonicalPath: '/work/other' },
    ]
    expect(HistoryPage.defaultProjectPath({ currentProjectPath: '/work/other', projects })).toBe('/work/other')
    expect(HistoryPage.defaultProjectPath({ currentProjectPath: null, projects })).toBe('/work/sample')
    expect(HistoryPage.defaultProjectPath({ currentProjectPath: null, projects: [] })).toBeUndefined()
  })
})
