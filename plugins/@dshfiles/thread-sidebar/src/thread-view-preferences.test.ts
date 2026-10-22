import { describe, expect, it } from 'vitest'
import {
  ALL_THREADS_VIEW_ID,
  DEFAULT_THREAD_VIEW_PRESETS,
  DEFAULT_THREAD_VIEW_SETTINGS,
  DONE_VIEW_ID,
  LEGACY_CURRENT_VIEW_ID,
  ThreadViewPreferencesModel,
  WORKING_VIEW_ID,
  type ThreadViewPreset,
} from './thread-view-preferences.js'

const attentionView: ThreadViewPreset = {
  id: 'attention-view',
  name: 'Needs attention',
  enabled: true,
  groupBy: 'date',
  statusFilters: ['attention'],
  sourceFilter: 'main',
}

describe('thread view preferences', () => {
  it('ships All threads, Working and Done defaults', () => {
    expect(DEFAULT_THREAD_VIEW_SETTINGS).toMatchObject({
      views: [
        { id: ALL_THREADS_VIEW_ID, name: null, groupBy: 'status', statusFilters: [], sourceFilter: 'all', enabled: true },
        { id: WORKING_VIEW_ID, name: null, groupBy: 'status', statusFilters: ['working'], sourceFilter: 'all', enabled: true },
        { id: DONE_VIEW_ID, name: null, groupBy: 'status', statusFilters: ['turn-finished'], sourceFilter: 'all', enabled: true },
      ],
      activeViewId: ALL_THREADS_VIEW_ID,
      showGroupControl: true,
      showFilterControl: true,
    })
  })

  it('keeps attention dots off All threads while showing them on matching presets', () => {
    const entries = [
      {
        thread: {},
        attentionLabel: 'threadSidebarInputNeeded',
        running: true,
        archived: false,
        settled: false,
        muted: false,
      },
      {
        thread: {},
        attentionLabel: 'threadSidebarTurnFinished',
        running: false,
        archived: false,
        settled: false,
        muted: false,
      },
    ] as const

    expect(ThreadViewPreferencesModel.attentionLabelForPreset(DEFAULT_THREAD_VIEW_PRESETS[0], entries)).toBeUndefined()
    expect(ThreadViewPreferencesModel.attentionLabelForPreset(DEFAULT_THREAD_VIEW_PRESETS[1], entries)).toBe('threadSidebarInputNeeded')
    expect(ThreadViewPreferencesModel.attentionLabelForPreset(DEFAULT_THREAD_VIEW_PRESETS[2], entries)).toBe('threadSidebarTurnFinished')
  })

  it('counts unread threads on saved views but never on All threads', () => {
    const doneView: ThreadViewPreset = {
      id: 'my-review',
      name: 'Review',
      enabled: true,
      groupBy: 'status',
      statusFilters: ['turn-finished'],
      sourceFilter: 'all',
    }
    const entries = [
      { thread: {}, attentionLabel: 'threadSidebarTurnFinished', unread: true, running: false, archived: false, settled: false, muted: false },
      { thread: {}, attentionLabel: undefined, unread: true, running: false, archived: false, settled: true, muted: false },
      { thread: {}, attentionLabel: undefined, unread: false, running: false, archived: false, settled: false, muted: false },
    ] as const

    expect(ThreadViewPreferencesModel.unreadCountForPreset(DEFAULT_THREAD_VIEW_PRESETS[0], entries)).toBe(0)
    expect(ThreadViewPreferencesModel.unreadCountForPreset(doneView, entries)).toBe(1)
    expect(ThreadViewPreferencesModel.unreadCountForPreset(DEFAULT_THREAD_VIEW_PRESETS[2], entries)).toBe(1)
  })

  it('decodes individual group and filter presets', () => {
    expect(ThreadViewPreferencesModel.decodeThreadViewPreferences({ groupBy: 'date' })).toEqual({
      groupBy: 'date',
      statusFilters: [],
      sourceFilter: 'all',
    })
    expect(ThreadViewPreferencesModel.decodeThreadViewPreferences({ statusFilters: ['turn-finished', 'attention'] })).toEqual({
      groupBy: 'status',
      statusFilters: ['turn-finished', 'attention'],
      sourceFilter: 'all',
    })
    expect(ThreadViewPreferencesModel.decodeThreadViewPreferences({ groupBy: 'model' })).toBeNull()
    expect(ThreadViewPreferencesModel.decodeThreadViewPreferences({ groupBy: 'date', unexpected: true })).toBeNull()
  })

  it('rewrites a saved not-working view into the attention labels it stood for', () => {
    expect(ThreadViewPreferencesModel.decodeThreadViewPreferences({ statusFilters: ['not-working', 'attention'] })).toEqual({
      groupBy: 'status',
      statusFilters: ['input-needed', 'turn-finished', 'interrupted', 'attention'],
      sourceFilter: 'all',
    })
    expect(
      ThreadViewPreferencesModel.decodeThreadViewSettings({
        views: [{ id: 'my-review', name: 'Review', enabled: true, groupBy: 'status', statusFilters: ['not-working'], sourceFilter: 'all' }],
        activeViewId: 'my-review',
      })?.views[0]?.statusFilters,
    ).toEqual(['input-needed', 'turn-finished', 'interrupted'])
  })

  it('migrates legacy preferences without losing the active grouping and filters', () => {
    expect(ThreadViewPreferencesModel.decodeThreadViewSettings({ groupBy: 'date', statusFilter: 'archived', sourceFilter: 'main' })).toMatchObject({
      views: [
        { id: ALL_THREADS_VIEW_ID, groupBy: 'status', statusFilters: [], sourceFilter: 'all' },
        { id: WORKING_VIEW_ID, groupBy: 'status', statusFilters: ['working'], sourceFilter: 'all' },
        { id: DONE_VIEW_ID, groupBy: 'status', statusFilters: ['turn-finished'], sourceFilter: 'all' },
        { id: LEGACY_CURRENT_VIEW_ID, name: null, groupBy: 'date', statusFilters: ['archived'], sourceFilter: 'main', enabled: true },
      ],
      activeViewId: LEGACY_CURRENT_VIEW_ID,
      showGroupControl: true,
      showFilterControl: true,
    })
  })

  it('migrates saved presets with single statuses to status sets', () => {
    const legacySettings = {
      views: [
        { id: ALL_THREADS_VIEW_ID, name: null, groupBy: 'status', statusFilter: 'all', sourceFilter: 'all', enabled: true },
        { id: WORKING_VIEW_ID, name: null, groupBy: 'status', statusFilter: 'working', sourceFilter: 'all', enabled: true },
        {
          id: attentionView.id,
          name: attentionView.name,
          enabled: true,
          groupBy: attentionView.groupBy,
          statusFilter: 'attention',
          sourceFilter: attentionView.sourceFilter,
        },
      ],
      activeViewId: attentionView.id,
    }
    expect(ThreadViewPreferencesModel.decodeThreadViewSettings(legacySettings)?.views).toEqual([
      DEFAULT_THREAD_VIEW_PRESETS[0],
      DEFAULT_THREAD_VIEW_PRESETS[1],
      { ...attentionView },
    ])
  })

  it('maps an unchanged legacy default to its matching default tab', () => {
    expect(ThreadViewPreferencesModel.decodeThreadViewSettings({ groupBy: 'status', statusFilter: 'working', sourceFilter: 'all' })).toMatchObject({
      ...DEFAULT_THREAD_VIEW_SETTINGS,
      activeViewId: WORKING_VIEW_ID,
    })
  })

  it('rejects malformed presets, duplicate ids or names, and disabling every view', () => {
    expect(ThreadViewPreferencesModel.decodeThreadViewSettings({ views: [], activeViewId: ALL_THREADS_VIEW_ID })).toBeNull()
    expect(
      ThreadViewPreferencesModel.decodeThreadViewSettings({
        views: [attentionView, { ...attentionView, id: 'another-view' }],
        activeViewId: attentionView.id,
      }),
    ).toBeNull()
    expect(
      ThreadViewPreferencesModel.decodeThreadViewSettings({
        views: [attentionView, { ...attentionView, name: 'Needs attention', id: 'another-view' }],
        activeViewId: attentionView.id,
      }),
    ).toBeNull()
    expect(
      ThreadViewPreferencesModel.decodeThreadViewSettings({
        views: DEFAULT_THREAD_VIEW_SETTINGS.views.map(view => ({ ...view, enabled: false })),
        activeViewId: ALL_THREADS_VIEW_ID,
      }),
    ).toBeNull()
  })

  it('selects only enabled presets and falls back from a disabled active view', () => {
    expect(ThreadViewPreferencesModel.selectThreadView(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID).activeViewId).toBe(WORKING_VIEW_ID)
    expect(ThreadViewPreferencesModel.selectThreadView(DEFAULT_THREAD_VIEW_SETTINGS, 'missing')).toBe(DEFAULT_THREAD_VIEW_SETTINGS)
    const disabled = ThreadViewPreferencesModel.setThreadViewEnabled(
      ThreadViewPreferencesModel.selectThreadView(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID),
      WORKING_VIEW_ID,
      false,
    )
    expect(disabled.activeViewId).toBe(ALL_THREADS_VIEW_ID)
    expect(disabled.views.find(view => view.id === WORKING_VIEW_ID)?.enabled).toBe(false)
  })

  it('reorders presets in either direction and leaves boundary moves unchanged', () => {
    const settings = ThreadViewPreferencesModel.saveThreadView(DEFAULT_THREAD_VIEW_SETTINGS, attentionView)
    const movedUp = ThreadViewPreferencesModel.moveThreadView(settings, attentionView.id, -1)
    expect(movedUp.views.map(view => view.id)).toEqual([ALL_THREADS_VIEW_ID, WORKING_VIEW_ID, attentionView.id, DONE_VIEW_ID])
    const movedToTop = ThreadViewPreferencesModel.moveThreadView(movedUp, attentionView.id, -1)
    expect(movedToTop.views.map(view => view.id)).toEqual([ALL_THREADS_VIEW_ID, attentionView.id, WORKING_VIEW_ID, DONE_VIEW_ID])
    const movedFirst = ThreadViewPreferencesModel.moveThreadView(movedToTop, attentionView.id, -1)
    expect(movedFirst.views.map(view => view.id)).toEqual([attentionView.id, ALL_THREADS_VIEW_ID, WORKING_VIEW_ID, DONE_VIEW_ID])
    expect(ThreadViewPreferencesModel.moveThreadView(movedFirst, attentionView.id, -1)).toBe(movedFirst)
    expect(ThreadViewPreferencesModel.moveThreadView(settings, ALL_THREADS_VIEW_ID, 1).views.map(view => view.id)).toEqual([
      WORKING_VIEW_ID,
      ALL_THREADS_VIEW_ID,
      DONE_VIEW_ID,
      attentionView.id,
    ])
  })

  it('removes presets and selects a remaining enabled view when needed', () => {
    const oneEnabled = ThreadViewPreferencesModel.setThreadViewEnabled(
      ThreadViewPreferencesModel.setThreadViewEnabled(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID, false),
      DONE_VIEW_ID,
      false,
    )
    expect(ThreadViewPreferencesModel.removeThreadView(oneEnabled, ALL_THREADS_VIEW_ID)).toBe(oneEnabled)

    const withCustom = ThreadViewPreferencesModel.saveThreadView(
      ThreadViewPreferencesModel.selectThreadView(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID),
      attentionView,
    )
    const withoutWorking = ThreadViewPreferencesModel.removeThreadView(withCustom, WORKING_VIEW_ID)
    expect(withoutWorking.activeViewId).toBe(ALL_THREADS_VIEW_ID)
    expect(withoutWorking.views.map(view => view.id)).toEqual([ALL_THREADS_VIEW_ID, DONE_VIEW_ID, attentionView.id])
    const oneView = ThreadViewPreferencesModel.removeThreadView({ ...withoutWorking, views: [attentionView], activeViewId: attentionView.id }, attentionView.id)
    expect(oneView.views).toEqual([attentionView])
  })

  it('updates an existing preset or adds a new preset without changing selection', () => {
    const renamed = { ...DEFAULT_THREAD_VIEW_PRESETS[0], name: 'Everything' }
    const updated = ThreadViewPreferencesModel.saveThreadView(DEFAULT_THREAD_VIEW_SETTINGS, renamed)
    expect(updated.views[0]?.name).toBe('Everything')
    const added = ThreadViewPreferencesModel.saveThreadView(updated, attentionView)
    expect(added.views.at(-1)).toEqual(attentionView)
    expect(added.activeViewId).toBe(ALL_THREADS_VIEW_ID)
  })
})

describe('saved-view preference updates', () => {
  it('applies a patch to the active view and keeps the rest of the document', () => {
    const settings = {
      ...DEFAULT_THREAD_VIEW_SETTINGS,
      activeViewId: WORKING_VIEW_ID,
    }
    const updated = ThreadViewPreferencesModel.updateThreadViewPreferences(settings, { groupBy: 'project', statusFilters: ['attention'] })
    expect(updated.activeViewId).toBe(WORKING_VIEW_ID)
    expect(updated.views.find(view => view.id === WORKING_VIEW_ID)).toMatchObject({ groupBy: 'project', statusFilters: ['attention'] })
    expect(updated.views.find(view => view.id === ALL_THREADS_VIEW_ID)).toEqual(DEFAULT_THREAD_VIEW_SETTINGS.views[0])
  })

  it('clones the view list so a saved document never aliases its input', () => {
    const saved = ThreadViewPreferencesModel.updateThreadViewSettings(DEFAULT_THREAD_VIEW_SETTINGS)
    expect(saved.views).not.toBe(DEFAULT_THREAD_VIEW_SETTINGS.views)
    expect(saved.views).toEqual(DEFAULT_THREAD_VIEW_SETTINGS.views)
  })
})
