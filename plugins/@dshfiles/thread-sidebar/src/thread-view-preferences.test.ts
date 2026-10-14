import { describe, expect, it } from 'vitest'
import {
  ALL_THREADS_VIEW_ID,
  DEFAULT_THREAD_VIEW_PRESETS,
  DEFAULT_THREAD_VIEW_SETTINGS,
  LEGACY_CURRENT_VIEW_ID,
  moveThreadView,
  removeThreadView,
  saveThreadView,
  selectThreadView,
  setThreadViewEnabled,
  WORKING_VIEW_ID,
  decodeThreadViewPreferences,
  decodeThreadViewSettings,
  type ThreadViewPreset,
} from './thread-view-preferences.js'

const attentionView: ThreadViewPreset = {
  id: 'attention-view',
  name: 'Needs attention',
  enabled: true,
  groupBy: 'date',
  statusFilter: 'attention',
  sourceFilter: 'main',
}

describe('thread view preferences', () => {
  it('keeps the existing All threads and Working defaults', () => {
    expect(DEFAULT_THREAD_VIEW_SETTINGS).toMatchObject({
      views: [
        { id: ALL_THREADS_VIEW_ID, name: null, groupBy: 'status', statusFilter: 'all', sourceFilter: 'all', enabled: true },
        { id: WORKING_VIEW_ID, name: null, groupBy: 'status', statusFilter: 'working', sourceFilter: 'all', enabled: true },
      ],
      activeViewId: ALL_THREADS_VIEW_ID,
      showGroupControl: true,
      showFilterControl: true,
    })
  })

  it('decodes individual group and filter presets', () => {
    expect(decodeThreadViewPreferences({ groupBy: 'date' })).toEqual({
      groupBy: 'date',
      statusFilter: 'all',
      sourceFilter: 'all',
    })
    expect(decodeThreadViewPreferences({ statusFilter: 'not-working' })).toEqual({
      groupBy: 'status',
      statusFilter: 'not-working',
      sourceFilter: 'all',
    })
    expect(decodeThreadViewPreferences({ groupBy: 'model' })).toBeNull()
    expect(decodeThreadViewPreferences({ groupBy: 'date', unexpected: true })).toBeNull()
  })

  it('migrates legacy preferences without losing the active grouping and filters', () => {
    expect(decodeThreadViewSettings({ groupBy: 'date', statusFilter: 'archived', sourceFilter: 'main' })).toMatchObject({
      views: [
        { id: ALL_THREADS_VIEW_ID, groupBy: 'status', statusFilter: 'all', sourceFilter: 'all' },
        { id: WORKING_VIEW_ID, groupBy: 'status', statusFilter: 'working', sourceFilter: 'all' },
        { id: LEGACY_CURRENT_VIEW_ID, name: null, groupBy: 'date', statusFilter: 'archived', sourceFilter: 'main', enabled: true },
      ],
      activeViewId: LEGACY_CURRENT_VIEW_ID,
      showGroupControl: true,
      showFilterControl: true,
    })
  })

  it('maps an unchanged legacy default to its matching default tab', () => {
    expect(decodeThreadViewSettings({ groupBy: 'status', statusFilter: 'working', sourceFilter: 'all' })).toMatchObject({
      ...DEFAULT_THREAD_VIEW_SETTINGS,
      activeViewId: WORKING_VIEW_ID,
    })
  })

  it('rejects malformed presets, duplicate ids or names, and disabling every view', () => {
    expect(decodeThreadViewSettings({ views: [], activeViewId: ALL_THREADS_VIEW_ID })).toBeNull()
    expect(
      decodeThreadViewSettings({
        views: [attentionView, { ...attentionView, id: 'another-view' }],
        activeViewId: attentionView.id,
      }),
    ).toBeNull()
    expect(
      decodeThreadViewSettings({
        views: [attentionView, { ...attentionView, name: 'Needs attention', id: 'another-view' }],
        activeViewId: attentionView.id,
      }),
    ).toBeNull()
    expect(
      decodeThreadViewSettings({
        views: DEFAULT_THREAD_VIEW_SETTINGS.views.map(view => ({ ...view, enabled: false })),
        activeViewId: ALL_THREADS_VIEW_ID,
      }),
    ).toBeNull()
  })

  it('selects only enabled presets and falls back from a disabled active view', () => {
    expect(selectThreadView(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID).activeViewId).toBe(WORKING_VIEW_ID)
    expect(selectThreadView(DEFAULT_THREAD_VIEW_SETTINGS, 'missing')).toBe(DEFAULT_THREAD_VIEW_SETTINGS)
    const disabled = setThreadViewEnabled(selectThreadView(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID), WORKING_VIEW_ID, false)
    expect(disabled.activeViewId).toBe(ALL_THREADS_VIEW_ID)
    expect(disabled.views.find(view => view.id === WORKING_VIEW_ID)?.enabled).toBe(false)
  })

  it('reorders presets in either direction and leaves boundary moves unchanged', () => {
    const settings = saveThreadView(DEFAULT_THREAD_VIEW_SETTINGS, attentionView)
    const movedUp = moveThreadView(settings, attentionView.id, -1)
    expect(movedUp.views.map(view => view.id)).toEqual([ALL_THREADS_VIEW_ID, attentionView.id, WORKING_VIEW_ID])
    const movedToTop = moveThreadView(movedUp, attentionView.id, -1)
    expect(movedToTop.views.map(view => view.id)).toEqual([attentionView.id, ALL_THREADS_VIEW_ID, WORKING_VIEW_ID])
    expect(moveThreadView(movedToTop, attentionView.id, -1)).toBe(movedToTop)
    expect(moveThreadView(settings, ALL_THREADS_VIEW_ID, 1).views.map(view => view.id)).toEqual([WORKING_VIEW_ID, ALL_THREADS_VIEW_ID, attentionView.id])
  })

  it('removes presets and selects a remaining enabled view when needed', () => {
    const onlyEnabled = setThreadViewEnabled(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID, false)
    expect(removeThreadView(onlyEnabled, ALL_THREADS_VIEW_ID)).toBe(onlyEnabled)

    const withCustom = saveThreadView(selectThreadView(DEFAULT_THREAD_VIEW_SETTINGS, WORKING_VIEW_ID), attentionView)
    const withoutWorking = removeThreadView(withCustom, WORKING_VIEW_ID)
    expect(withoutWorking.activeViewId).toBe(ALL_THREADS_VIEW_ID)
    expect(withoutWorking.views.map(view => view.id)).toEqual([ALL_THREADS_VIEW_ID, attentionView.id])
    const oneView = removeThreadView({ ...withoutWorking, views: [attentionView], activeViewId: attentionView.id }, attentionView.id)
    expect(oneView.views).toEqual([attentionView])
  })

  it('updates an existing preset or adds a new preset without changing selection', () => {
    const renamed = { ...DEFAULT_THREAD_VIEW_PRESETS[0], name: 'Everything' }
    const updated = saveThreadView(DEFAULT_THREAD_VIEW_SETTINGS, renamed)
    expect(updated.views[0]?.name).toBe('Everything')
    const added = saveThreadView(updated, attentionView)
    expect(added.views.at(-1)).toEqual(attentionView)
    expect(added.activeViewId).toBe(ALL_THREADS_VIEW_ID)
  })
})
