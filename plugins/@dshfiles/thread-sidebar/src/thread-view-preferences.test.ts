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
  type ThreadViewSettings,
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
  it('ships exactly the requested three defaults with Done active', () => {
    expect(DEFAULT_THREAD_VIEW_SETTINGS).toEqual({
      views: [
        { id: ALL_THREADS_VIEW_ID, name: null, enabled: true, groupBy: 'status', statusFilters: [], sourceFilter: 'all' },
        { id: WORKING_VIEW_ID, name: null, enabled: true, groupBy: 'status', statusFilters: ['working'], sourceFilter: 'all' },
        { id: DONE_VIEW_ID, name: null, enabled: true, groupBy: 'date', statusFilters: ['not-running', 'attention'], sourceFilter: 'main' },
      ],
      activeViewId: DONE_VIEW_ID,
      showGroupControl: true,
      showFilterControl: true,
    })
  })

  it('decodes the exact legacy browser document without restoring removed tabs or losing custom Done', () => {
    const raw =
      '{"views":[{"id":"all-threads","name":null,"enabled":true,"groupBy":"status","statusFilters":[],"sourceFilter":"all"},{"id":"working","name":null,"enabled":true,"groupBy":"status","statusFilters":["working"],"sourceFilter":"all"},{"id":"custom-548d9702-a284-4342-94bb-122a540a4492","name":"Done","enabled":true,"groupBy":"date","statusFilters":["not-working","attention"],"sourceFilter":"main"}],"activeViewId":"custom-548d9702-a284-4342-94bb-122a540a4492","showGroupControl":true,"showFilterControl":true}'
    const decoded = ThreadViewPreferencesModel.decodeThreadViewSettings(JSON.parse(raw))
    expect(decoded).not.toBeNull()
    if (decoded === null) return
    const migrated = ThreadViewPreferencesModel.upgradeShippedViewFilters(ThreadViewPreferencesModel.migrateDoneViewSettings(decoded))
    expect(migrated).toEqual({
      ...JSON.parse(raw),
      views: [
        DEFAULT_THREAD_VIEW_PRESETS[0],
        DEFAULT_THREAD_VIEW_PRESETS[1],
        {
          id: 'custom-548d9702-a284-4342-94bb-122a540a4492',
          name: 'Done',
          enabled: true,
          groupBy: 'date',
          statusFilters: ['not-running', 'attention'],
          sourceFilter: 'main',
        },
      ],
    })
    expect(ThreadViewPreferencesModel.decodeThreadViewSettings(migrated)).toEqual(migrated)
  })

  it('recognizes exact previous five-view Host defaults so the browser custom document wins migration', () => {
    for (const workingFilters of [['working'], ['working', 'interrupted']] satisfies readonly (readonly import('./thread-view.js').ThreadStatusFilter[])[]) {
      for (const doneFilters of [
        ['inactive', 'interrupted'],
        ['inactive', 'interrupted', 'needs-resume'],
      ] satisfies readonly (readonly import('./thread-view.js').ThreadStatusFilter[])[]) {
        const oldHost: ThreadViewSettings = {
          ...DEFAULT_THREAD_VIEW_SETTINGS,
          activeViewId: ALL_THREADS_VIEW_ID,
          views: [
            DEFAULT_THREAD_VIEW_PRESETS[0],
            { ...DEFAULT_THREAD_VIEW_PRESETS[1], statusFilters: workingFilters },
            { ...DEFAULT_THREAD_VIEW_PRESETS[2], groupBy: 'status', statusFilters: doneFilters },
            {
              id: 'inbox',
              name: null,
              enabled: true,
              groupBy: 'status',
              statusFilters: ['approval-needed', 'input-needed', 'turn-finished', 'needs-resume', 'interrupted'],
              sourceFilter: 'all',
            },
            { id: 'gone', name: null, enabled: true, groupBy: 'status', statusFilters: ['muted', 'settled', 'archived'], sourceFilter: 'all' },
          ],
        }
        const browser = ThreadViewPreferencesModel.decodeThreadViewSettings({
          ...DEFAULT_THREAD_VIEW_SETTINGS,
          views: [
            DEFAULT_THREAD_VIEW_PRESETS[0],
            DEFAULT_THREAD_VIEW_PRESETS[1],
            { ...DEFAULT_THREAD_VIEW_PRESETS[2], id: 'custom-548d9702-a284-4342-94bb-122a540a4492', name: 'Done', statusFilters: ['not-working', 'attention'] },
          ],
          activeViewId: 'custom-548d9702-a284-4342-94bb-122a540a4492',
        })
        expect(ThreadViewPreferencesModel.isDefaultThreadViewSettings(oldHost)).toBe(true)
        const source = ThreadViewPreferencesModel.isDefaultThreadViewSettings(oldHost) && browser !== null ? browser : oldHost
        expect(source).toBe(browser)
        expect(source.views).toHaveLength(3)
        expect(source.activeViewId).toBe('custom-548d9702-a284-4342-94bb-122a540a4492')
        expect(ThreadViewPreferencesModel.isDefaultThreadViewSettings({ ...oldHost, showFilterControl: false })).toBe(false)
        expect(
          ThreadViewPreferencesModel.isDefaultThreadViewSettings({
            ...oldHost,
            views: oldHost.views.map(view => (view.id === DONE_VIEW_ID ? { ...view, name: 'Custom done' } : view)),
          }),
        ).toBe(false)
        expect(
          ThreadViewPreferencesModel.isDefaultThreadViewSettings({
            ...oldHost,
            views: oldHost.views.map(view => (view.id === DONE_VIEW_ID ? { ...view, groupBy: 'date' } : view)),
          }),
        ).toBe(false)
      }
    }
  })

  it('restricts the shipped Working view to running threads and adds usage-limit threads to the shipped Done view', () => {
    const laterView: ThreadViewPreset = {
      id: 'later',
      name: 'Later',
      enabled: true,
      groupBy: 'date',
      statusFilters: ['working', 'interrupted'],
      sourceFilter: 'all',
    }
    const previousShipped: ThreadViewSettings = {
      ...DEFAULT_THREAD_VIEW_SETTINGS,
      views: [
        DEFAULT_THREAD_VIEW_PRESETS[0],
        { ...DEFAULT_THREAD_VIEW_PRESETS[2], statusFilters: ['interrupted', 'inactive'], enabled: false },
        { ...DEFAULT_THREAD_VIEW_PRESETS[1], statusFilters: ['working', 'interrupted'] },
        laterView,
      ],
      activeViewId: DONE_VIEW_ID,
      showFilterControl: false,
    }

    const upgraded = ThreadViewPreferencesModel.upgradeShippedViewFilters(previousShipped)

    expect(upgraded).toMatchObject({
      views: [
        { id: ALL_THREADS_VIEW_ID, statusFilters: [] },
        { id: DONE_VIEW_ID, statusFilters: ['not-running', 'attention'], enabled: false },
        { id: WORKING_VIEW_ID, statusFilters: ['working'] },
        laterView,
      ],
      activeViewId: DONE_VIEW_ID,
      showFilterControl: false,
    })
    expect(ThreadViewPreferencesModel.upgradeShippedViewFilters(upgraded)).toBe(upgraded)
    expect(
      ThreadViewPreferencesModel.isDefaultThreadViewSettings({
        ...DEFAULT_THREAD_VIEW_SETTINGS,
        views: [
          DEFAULT_THREAD_VIEW_PRESETS[0],
          { ...DEFAULT_THREAD_VIEW_PRESETS[1], statusFilters: ['working', 'interrupted'] },
          { ...DEFAULT_THREAD_VIEW_PRESETS[2], statusFilters: ['inactive', 'interrupted'] },
        ],
      }),
    ).toBe(true)
  })

  it('badges Done for a usage-limit thread and keeps a stopped interrupted thread off Working', () => {
    const usageLimited = { thread: {}, attentionLabel: 'threadSidebarNeedsResume', running: false, archived: false, settled: false, muted: false } as const
    const interrupted = { thread: {}, attentionLabel: 'threadSidebarInterrupted', running: false, archived: false, settled: false, muted: false } as const

    expect(ThreadViewPreferencesModel.attentionLabelForPreset(DEFAULT_THREAD_VIEW_PRESETS[2], [usageLimited])).toBe('threadSidebarNeedsResume')
    expect(ThreadViewPreferencesModel.attentionLabelForPreset(DEFAULT_THREAD_VIEW_PRESETS[1], [usageLimited, interrupted])).toBeUndefined()
  })

  it('keeps built-in Working and Done views the user edited or renamed', () => {
    const edited: ThreadViewSettings = {
      ...DEFAULT_THREAD_VIEW_SETTINGS,
      views: [
        { ...DEFAULT_THREAD_VIEW_PRESETS[1], statusFilters: ['working', 'interrupted', 'unread'] },
        { ...DEFAULT_THREAD_VIEW_PRESETS[2], name: 'Finished', statusFilters: ['inactive', 'interrupted'] },
      ],
      activeViewId: WORKING_VIEW_ID,
    }

    expect(ThreadViewPreferencesModel.upgradeShippedViewFilters(edited)).toBe(edited)
    expect(ThreadViewPreferencesModel.isDefaultThreadViewSettings(edited)).toBe(false)
  })

  it('preserves edited custom Done filters rather than appending statuses', () => {
    const customDone: ThreadViewPreset = {
      id: 'done-custom',
      name: 'Done',
      enabled: true,
      groupBy: 'status',
      statusFilters: ['turn-finished'],
      sourceFilter: 'main',
    }
    const settings: ThreadViewSettings = { ...DEFAULT_THREAD_VIEW_SETTINGS, views: [...DEFAULT_THREAD_VIEW_SETTINGS.views, customDone] }
    const migrated = ThreadViewPreferencesModel.migrateDoneViewSettings(settings)

    expect(migrated.views.find(view => view.id === customDone.id)).toMatchObject({
      name: 'Done',
      statusFilters: ['turn-finished'],
      sourceFilter: 'main',
    })
    expect(ThreadViewPreferencesModel.migrateDoneViewSettings(migrated)).toBe(migrated)
  })

  it('keeps attention dots off All threads while showing them on matching presets', () => {
    const inputNeeded = {
      thread: {},
      attentionLabel: 'threadSidebarInputNeeded',
      running: true,
      archived: false,
      settled: false,
      muted: false,
    } as const
    const turnFinished = {
      thread: {},
      attentionLabel: 'threadSidebarTurnFinished',
      running: false,
      archived: false,
      settled: false,
      muted: false,
    } as const
    const interrupted = {
      thread: {},
      attentionLabel: 'threadSidebarInterrupted',
      running: false,
      archived: false,
      settled: false,
      muted: false,
    } as const
    const entries = [inputNeeded, turnFinished] as const

    expect(ThreadViewPreferencesModel.attentionLabelForPreset(DEFAULT_THREAD_VIEW_PRESETS[0], entries)).toBeUndefined()
    expect(ThreadViewPreferencesModel.attentionLabelForPreset(DEFAULT_THREAD_VIEW_PRESETS[1], entries)).toBe('threadSidebarInputNeeded')
    expect(ThreadViewPreferencesModel.attentionLabelForPreset(DEFAULT_THREAD_VIEW_PRESETS[2], [interrupted])).toBe('threadSidebarInterrupted')
  })

  it('allows one attention thread to badge independent Working and Done views', () => {
    const interrupted = {
      thread: {},
      attentionLabel: 'threadSidebarInterrupted',
      running: true,
      archived: false,
      settled: false,
      muted: false,
    } as const
    const working: ThreadViewPreset = {
      id: 'working-plus-interrupted',
      name: 'Working',
      enabled: true,
      groupBy: 'status',
      statusFilters: ['working', 'interrupted'],
      sourceFilter: 'all',
    }
    const done: ThreadViewPreset = {
      id: 'done-plus-interrupted',
      name: 'Done',
      enabled: true,
      groupBy: 'status',
      statusFilters: ['inactive', 'interrupted'],
      sourceFilter: 'all',
    }

    expect(ThreadViewPreferencesModel.attentionLabelForPreset(working, [interrupted])).toBe('threadSidebarInterrupted')
    expect(ThreadViewPreferencesModel.attentionLabelForPreset(done, [interrupted])).toBe('threadSidebarInterrupted')
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
      statusFilters: ['not-running', 'attention'],
      sourceFilter: 'all',
    })
    expect(
      ThreadViewPreferencesModel.decodeThreadViewSettings({
        views: [{ id: 'my-review', name: 'Review', enabled: true, groupBy: 'status', statusFilters: ['not-working'], sourceFilter: 'all' }],
        activeViewId: 'my-review',
      })?.views[0]?.statusFilters,
    ).toEqual(['not-running'])
  })

  it('migrates legacy preferences without losing the active grouping and filters', () => {
    expect(ThreadViewPreferencesModel.decodeThreadViewSettings({ groupBy: 'date', statusFilter: 'archived', sourceFilter: 'main' })).toMatchObject({
      views: [
        { id: ALL_THREADS_VIEW_ID, groupBy: 'status', statusFilters: [], sourceFilter: 'all' },
        { id: WORKING_VIEW_ID, groupBy: 'status', statusFilters: ['working'], sourceFilter: 'all' },
        { id: DONE_VIEW_ID, groupBy: 'date', statusFilters: ['not-running', 'attention'], sourceFilter: 'main' },
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
      { ...DEFAULT_THREAD_VIEW_PRESETS[1], statusFilters: ['working'] },
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

  it('reorders presets and leaves boundary moves unchanged', () => {
    const settings = ThreadViewPreferencesModel.saveThreadView(DEFAULT_THREAD_VIEW_SETTINGS, attentionView)
    const movedUp = ThreadViewPreferencesModel.moveThreadView(settings, attentionView.id, -1)
    expect(movedUp.views.map(view => view.id)).toEqual([ALL_THREADS_VIEW_ID, WORKING_VIEW_ID, attentionView.id, DONE_VIEW_ID])
    const movedTwice = ThreadViewPreferencesModel.moveThreadView(movedUp, attentionView.id, -1)
    const movedFirst = ThreadViewPreferencesModel.moveThreadView(movedTwice, attentionView.id, -1)
    expect(movedFirst.views.map(view => view.id)).toEqual([attentionView.id, ALL_THREADS_VIEW_ID, WORKING_VIEW_ID, DONE_VIEW_ID])
    expect(ThreadViewPreferencesModel.moveThreadView(movedFirst, attentionView.id, -1)).toBe(movedFirst)
    expect(ThreadViewPreferencesModel.moveThreadView(settings, attentionView.id, 1)).toBe(settings)
  })

  it('removes presets and selects a remaining enabled view when needed', () => {
    const oneEnabled = [WORKING_VIEW_ID, DONE_VIEW_ID].reduce(
      (settings, viewId) => ThreadViewPreferencesModel.setThreadViewEnabled(settings, viewId, false),
      DEFAULT_THREAD_VIEW_SETTINGS,
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
    expect(added.activeViewId).toBe(DONE_VIEW_ID)
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
