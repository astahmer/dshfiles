import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { presetNameIssue } from './filter-presets.js'
import {
  ALL_THREADS_VIEW_ID,
  DEFAULT_THREAD_VIEW_SETTINGS,
  DONE_VIEW_ID,
  MAX_THREAD_VIEWS,
  ThreadViewPreferencesModel as Model,
  WORKING_VIEW_ID,
  type ThreadViewSettings,
} from './thread-view-preferences.js'

const working = (): ThreadViewSettings => Model.applyThreadViewPreset(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID).settings

describe('filter presets (b:xpvk)', () => {
  it('keeps a filter change as a draft beside the preset instead of rewriting it, and marks the list edited', () => {
    const edited = Model.editThreadViewFilters(working(), { statusFilters: ['working', 'attention'] })
    expect(edited.views.find(view => view.id === WORKING_VIEW_ID)?.statusFilters).toEqual(['working'])
    expect(edited.draft).toEqual({ groupBy: 'status', statusFilters: ['working', 'attention'], sourceFilter: 'all' })
    expect(Model.currentThreadViewFilters(edited).statusFilters).toEqual(['working', 'attention'])
    expect(Model.isThreadViewEdited(edited, null)).toBe(true)
    expect(Model.isThreadViewEdited(working(), null)).toBe(false)
  })

  it('drops the draft when the filters come back to the preset as saved', () => {
    const edited = Model.editThreadViewFilters(working(), { groupBy: 'date' })
    const back = Model.editThreadViewFilters(edited, { groupBy: 'status' })
    expect(back.draft).toBeUndefined()
    expect(Model.isThreadViewEdited(back, null)).toBe(false)
  })

  it('applying a preset, the active one included, discards the draft and sets the project scope it names', () => {
    const edited = Model.editThreadViewFilters(working(), { sourceFilter: 'main' })
    const reapplied = Model.applyThreadViewPreset(edited, WORKING_VIEW_ID)
    expect(reapplied.settings.draft).toBeUndefined()
    expect(reapplied.workspaceFilter).toBeUndefined()

    const scoped = Model.createPresetFromCurrent(edited, { id: 'mine', name: 'Mine', workspaceFilter: 'workspace-1' })
    const elsewhere = Model.applyThreadViewPreset(scoped, ALL_THREADS_VIEW_ID).settings
    expect(Model.applyThreadViewPreset(elsewhere, 'mine')).toEqual({ settings: { ...elsewhere, activeViewId: 'mine' }, workspaceFilter: 'workspace-1' })
    // A disabled or missing preset leaves everything as it was.
    expect(Model.applyThreadViewPreset(elsewhere, 'missing').settings).toBe(elsewhere)
  })

  it('a project scope that differs from the one the preset names counts as edited; a neutral preset ignores it', () => {
    const scoped = Model.createPresetFromCurrent(working(), { id: 'mine', name: 'Mine', workspaceFilter: 'workspace-1' })
    expect(Model.isThreadViewEdited(scoped, 'workspace-1')).toBe(false)
    expect(Model.isThreadViewEdited(scoped, null)).toBe(true)
    expect(Model.isThreadViewEdited(working(), 'workspace-2')).toBe(false)
  })

  it('saves the current filters as a new active preset with the project scope, and refuses nothing the schema allows', () => {
    const edited = Model.editThreadViewFilters(working(), { statusFilters: ['attention'], groupBy: 'project' })
    const saved = Model.createPresetFromCurrent(edited, { id: 'needs-you', name: '  Needs you ', workspaceFilter: null })
    expect(saved.activeViewId).toBe('needs-you')
    expect(saved.draft).toBeUndefined()
    expect(saved.views.at(-1)).toEqual({
      id: 'needs-you',
      name: 'Needs you',
      enabled: true,
      groupBy: 'project',
      statusFilters: ['attention'],
      sourceFilter: 'all',
      projectFilter: null,
    })
    // The working preset itself was never touched.
    expect(saved.views.find(view => view.id === WORKING_VIEW_ID)?.statusFilters).toEqual(['working'])
    expect(Model.decodeThreadViewSettings(saved)).toEqual(saved)
  })

  it('Save changes writes the draft into the active preset; a neutral preset stays neutral on All projects', () => {
    const edited = Model.editThreadViewFilters(working(), { sourceFilter: 'subagents' })
    const saved = Model.saveCurrentFiltersToPreset(edited, WORKING_VIEW_ID, null)
    expect(saved.draft).toBeUndefined()
    expect(saved.views.find(view => view.id === WORKING_VIEW_ID)).toEqual({ ...DEFAULT_THREAD_VIEW_SETTINGS.views[1], sourceFilter: 'subagents' })
    expect(Model.isThreadViewEdited(saved, null)).toBe(false)

    const scoped = Model.saveCurrentFiltersToPreset(working(), WORKING_VIEW_ID, 'workspace-1')
    expect(scoped.views.find(view => view.id === WORKING_VIEW_ID)?.projectFilter).toBe('workspace-1')
    // Updating another preset with the current filters keeps the active preset's draft.
    const other = Model.saveCurrentFiltersToPreset(edited, DONE_VIEW_ID, null)
    expect(other.draft).toEqual(edited.draft)
    expect(other.views.find(view => view.id === DONE_VIEW_ID)?.sourceFilter).toBe('subagents')
  })

  it('renames, deletes and restores a preset in place; deleting the active preset drops its draft', () => {
    const created = Model.createPresetFromCurrent(working(), { id: 'mine', name: 'Mine', workspaceFilter: null })
    const renamed = Model.renameThreadView(created, 'mine', ' Ours ')
    expect(renamed.views.find(view => view.id === 'mine')?.name).toBe('Ours')

    const edited = Model.editThreadViewFilters(renamed, { groupBy: 'none' })
    const position = edited.views.findIndex(view => view.id === WORKING_VIEW_ID)
    const view = edited.views[position]
    if (view === undefined) throw new Error('Working preset missing')
    const removed = Model.removeThreadView(Model.applyThreadViewPreset(edited, WORKING_VIEW_ID).settings, WORKING_VIEW_ID)
    expect(removed.views.some(candidate => candidate.id === WORKING_VIEW_ID)).toBe(false)
    expect(removed.draft).toBeUndefined()

    const restored = Model.insertThreadView(removed, view, position)
    expect(restored.views.map(candidate => candidate.id)).toEqual(renamed.views.map(candidate => candidate.id))
    expect(Model.insertThreadView(removed, view, 99).views.at(-1)?.id).toBe(WORKING_VIEW_ID)
  })

  it('[ and ] step through the enabled presets and wrap', () => {
    const settings = Model.setThreadViewEnabled(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID, false)
    expect(Model.adjacentThreadViewId(settings, 1)).toBe(DONE_VIEW_ID)
    expect(Model.adjacentThreadViewId(settings, -1)).toBe(DONE_VIEW_ID)
    expect(Model.adjacentThreadViewId(Model.applyThreadViewPreset(settings, DONE_VIEW_ID).settings, 1)).toBe(ALL_THREADS_VIEW_ID)
  })

  it('round-trips a document with a draft, a project scope and the preset switches through the stored schema', () => {
    const document = {
      ...Model.editThreadViewFilters(Model.createPresetFromCurrent(working(), { id: 'mine', name: 'Mine', workspaceFilter: '' }), { groupBy: 'date' }),
      showPresetChips: true,
    }
    // What a store round trip hands back: the JSON text read as plain data.
    const encoded = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(JSON.stringify(document))
    expect(Model.decodeThreadViewSettings(encoded)).toEqual(document)
    // A document written before presets decodes with them on and chips off.
    const { showPresets: _on, showPresetChips: _chips, ...older } = DEFAULT_THREAD_VIEW_SETTINGS
    expect(Model.decodeThreadViewSettings(older)).toEqual(DEFAULT_THREAD_VIEW_SETTINGS)
  })

  it('with presets off a filter change rewrites the active view, and turning them off folds a draft into it', () => {
    const off = Model.setPresetsEnabled(working(), false)
    const changed = Model.editThreadViewFilters(off, { sourceFilter: 'main' })
    expect(changed.draft).toBeUndefined()
    expect(changed.views.find(view => view.id === WORKING_VIEW_ID)?.sourceFilter).toBe('main')

    const edited = Model.editThreadViewFilters(working(), { groupBy: 'date' })
    const folded = Model.setPresetsEnabled(edited, false)
    expect(folded.showPresets).toBe(false)
    expect(folded.draft).toBeUndefined()
    expect(folded.views.find(view => view.id === WORKING_VIEW_ID)?.groupBy).toBe('date')
    expect(Model.currentThreadViewFilters(folded).groupBy).toBe('date')
    expect(Model.setPresetsEnabled(folded, true)).toEqual({ ...folded, showPresets: true })
  })

  it('checks a preset name: required, at most 32 characters, unique ignoring case', () => {
    expect(presetNameIssue('  ', [])).toBe('threadSidebarViewNameRequired')
    expect(presetNameIssue('x'.repeat(33), [])).toBe('threadSidebarViewNameTooLong')
    expect(presetNameIssue('working', ['Working'])).toBe('threadSidebarViewNameExists')
    expect(presetNameIssue('Needs you', ['Working'])).toBeUndefined()
    expect(MAX_THREAD_VIEWS).toBe(12)
  })
})
