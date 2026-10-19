import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { SidebarPreferencesModel } from './preferences.js'
import { threadSidebarSettings } from './settings.js'
import { ThreadNotificationModel } from './thread-notifications.js'

/**
 * The Host hands the plugin the settings schema's resolved output, and Schemastery drops a
 * null-valued union field from it. A decoder field without its own default therefore rejected every
 * Host document, which silently kept the whole namespace browser-local: this pins the two schemas
 * together so adding a nullable field without a decoder default fails here instead of in the browser.
 */
test('the settings schema and the preference decoder agree on every field', () => {
  const resolved = threadSidebarSettings.schema({})
  const decoded = SidebarPreferencesModel.decode(resolved)
  assert.ok(decoded, `decode rejected the resolved settings value: ${Object.keys(resolved).join(', ')}`)
  assert.deepEqual(decoded.settledSessionIds, [])
  assert.equal(decoded.autoSettleEnabled, false)
  assert.equal(decoded.workspaceFilter, null)
})

test('older stored preferences default the header and thread split to natural height', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: undefined })
  assert.ok(stored)
  assert.equal(SidebarPreferencesModel.decode(JSON.parse(stored))?.headerRegionHeight, null)
})

test('older preferences gain attention modes and default child-thread actions to enabled', () => {
  const { approvalNeededDisplay, inputNeededDisplay, turnFinishedDisplay, includeSubagentAttention, applyActionsToChildThreads, ...older } = DEFAULT_PREFERENCES
  const parsed = SidebarPreferencesModel.decode(older)
  assert.ok(parsed)
  assert.deepEqual(
    [parsed.approvalNeededDisplay, parsed.inputNeededDisplay, parsed.turnFinishedDisplay, parsed.includeSubagentAttention],
    [approvalNeededDisplay, inputNeededDisplay, turnFinishedDisplay, includeSubagentAttention],
  )
  assert.equal(applyActionsToChildThreads, true)
  assert.equal(parsed.applyActionsToChildThreads, true)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, applyActionsToChildThreads: false })?.applyActionsToChildThreads, false)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, turnFinishedDisplay: 'section' }), null)
})

test('older preferences default rebase-triggered auto-settle to disabled', () => {
  const { rebasedThreadSettleDelay, ...older } = DEFAULT_PREFERENCES
  assert.equal(rebasedThreadSettleDelay, 'disabled')
  assert.equal(SidebarPreferencesModel.decode(older)?.rebasedThreadSettleDelay, 'disabled')
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, rebasedThreadSettleDelay: 'after-1-day' })?.rebasedThreadSettleDelay, 'after-1-day')
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, rebasedThreadSettleDelay: 'after-5-minutes' }), null)
})

test('auto-archive preference keys from an older document decode as their auto-settle replacements', () => {
  const legacy = {
    ...DEFAULT_PREFERENCES,
    autoArchiveEnabled: true,
    autoArchiveSessionIds: ['settle-me'],
    autoArchiveDisabledSessionIds: ['keep-me'],
    rebasedThreadArchiveDelay: 'after-1-hour',
  }
  const {
    autoSettleEnabled: _autoSettleEnabled,
    autoSettleSessionIds: _autoSettleSessionIds,
    autoSettleDisabledSessionIds: _autoSettleDisabledSessionIds,
    rebasedThreadSettleDelay: _rebasedThreadSettleDelay,
    ...older
  } = legacy
  const parsed = SidebarPreferencesModel.decode(older)
  assert.ok(parsed)
  assert.equal(parsed.autoSettleEnabled, true)
  assert.deepEqual(parsed.autoSettleSessionIds, ['settle-me'])
  assert.deepEqual(parsed.autoSettleDisabledSessionIds, ['keep-me'])
  assert.equal(parsed.rebasedThreadSettleDelay, 'after-1-hour')
})

test('archive undo defaults on and rejects durations outside one through thirty seconds', () => {
  const { archiveUndoEnabled, archiveUndoDurationSeconds, ...older } = DEFAULT_PREFERENCES
  const parsed = SidebarPreferencesModel.decode(older)

  assert.ok(parsed)
  assert.equal(parsed.archiveUndoEnabled, archiveUndoEnabled)
  assert.equal(parsed.archiveUndoDurationSeconds, archiveUndoDurationSeconds)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, archiveUndoEnabled: false })?.archiveUndoEnabled, false)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, archiveUndoDurationSeconds: 1 })?.archiveUndoDurationSeconds, 1)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, archiveUndoDurationSeconds: 30 })?.archiveUndoDurationSeconds, 30)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, archiveUndoDurationSeconds: 0 }), null)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, archiveUndoDurationSeconds: 31 }), null)
})

test('older preferences default per-thread auto-settle overrides to inherit global behavior', () => {
  const { autoSettleSessionIds, autoSettleDisabledSessionIds, ...older } = DEFAULT_PREFERENCES
  assert.deepEqual(autoSettleSessionIds, [])
  assert.deepEqual(autoSettleDisabledSessionIds, [])
  assert.deepEqual(SidebarPreferencesModel.decode(older)?.autoSettleSessionIds, [])
  assert.deepEqual(SidebarPreferencesModel.decode(older)?.autoSettleDisabledSessionIds, [])
  const saved = SidebarPreferencesModel.decode({
    ...DEFAULT_PREFERENCES,
    autoSettleSessionIds: ['enabled-thread'],
    autoSettleDisabledSessionIds: ['disabled-thread'],
  })
  assert.deepEqual(saved?.autoSettleSessionIds, ['enabled-thread'])
  assert.deepEqual(saved?.autoSettleDisabledSessionIds, ['disabled-thread'])
})

test('valid saved split heights persist and invalid heights are rejected', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: 384 })
  const invalidStored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: 24 })

  assert.equal(SidebarPreferencesModel.decode(JSON.parse(stored))?.headerRegionHeight, 384)
  assert.equal(SidebarPreferencesModel.decode(JSON.parse(invalidStored)), null)
})

test('preferences saved before navigation and palette settings existed gain their defaults', () => {
  const { navigationDensity, navigationOverflow, paletteChord, threadSearchChord, paletteRecentLimit, ...older } = DEFAULT_PREFERENCES
  const parsed = SidebarPreferencesModel.decode({ ...older, headerMode: 'expanded' })
  assert.ok(parsed)
  assert.equal(parsed.headerMode, 'expanded')
  assert.deepEqual(
    [parsed.navigationDensity, parsed.navigationOverflow, parsed.paletteChord, parsed.threadSearchChord, parsed.paletteRecentLimit],
    [navigationDensity, navigationOverflow, paletteChord, threadSearchChord, paletteRecentLimit],
  )
})

test('a disabled chord persists as null', () => {
  assert.equal(SidebarPreferencesModel.decode(JSON.parse(JSON.stringify({ ...DEFAULT_PREFERENCES, paletteChord: null })))?.paletteChord, null)
})

test('migration copies browser values only into Host keys still at their default', () => {
  const local = { ...DEFAULT_PREFERENCES, headerMode: 'expanded' as const, idleMinutes: 300, footerOrder: ['settings'] }
  const host = { ...DEFAULT_PREFERENCES, idleMinutes: 60 }
  assert.deepEqual(SidebarPreferencesModel.preferencesToMigrate(local, host), { headerMode: 'expanded', footerOrder: ['settings'] })
  assert.deepEqual(SidebarPreferencesModel.preferencesToMigrate(DEFAULT_PREFERENCES, host), {})
})

test('Host settings values decode through the sidebar contract', () => {
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, headerMode: 'diagonal' }), null)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, headerRegionHeight: 200 })?.headerRegionHeight, 200)
})

test('older settings gain default attention colors and reject unknown semantic colors', () => {
  const { attentionColors, ...older } = DEFAULT_PREFERENCES
  assert.deepEqual(SidebarPreferencesModel.decode(older)?.attentionColors, attentionColors)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, attentionColors: { ...attentionColors, turnFinished: 'neon' } }), null)
})

test('attention colors migrate only when the Host still has defaults', () => {
  const local = { ...DEFAULT_PREFERENCES, attentionColors: { ...DEFAULT_PREFERENCES.attentionColors, turnFinished: 'warning' as const } }
  const host = { ...DEFAULT_PREFERENCES }
  assert.deepEqual(SidebarPreferencesModel.preferencesToMigrate(local, host), { attentionColors: local.attentionColors })
})

test('a Host namespace from before the brand-logo setting keeps the logo shown', () => {
  const { hideBrandLogo, ...older } = DEFAULT_PREFERENCES
  assert.equal(hideBrandLogo, false)
  assert.equal(SidebarPreferencesModel.decode(older)?.hideBrandLogo, false)
  assert.equal(SidebarPreferencesModel.decode({ ...older, hideBrandLogo: true })?.hideBrandLogo, true)
})

test('settings saved before the finished-subagents choice collapse them and reject unknown modes', () => {
  const { finishedSubagents, ...older } = DEFAULT_PREFERENCES
  assert.equal(SidebarPreferencesModel.decode(older)?.finishedSubagents, finishedSubagents)
  assert.equal(finishedSubagents, 'collapse')
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, finishedSubagents: 'archive' }), null)
})

test('the saved thread views live in the Host-synced preferences', () => {
  assert.deepEqual(SidebarPreferencesModel.decode(DEFAULT_PREFERENCES)?.threadViews, DEFAULT_PREFERENCES.threadViews)
  const custom = { ...DEFAULT_PREFERENCES.threadViews, activeViewId: 'working' }
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, threadViews: custom })?.threadViews.activeViewId, 'working')
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, threadViews: { ...custom, views: [] } }), null)
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, threadViews: { views: [{ id: 'x' }], activeViewId: 'x' } }), null)
})

test('legacy desktop alerts migrate to per-category system delivery unless the new setting is customized', () => {
  const { notificationCategories: _notificationCategories, ...legacyPreferences } = DEFAULT_PREFERENCES
  const migrated = SidebarPreferencesModel.decode({ ...legacyPreferences, desktopNotificationsEnabled: true })
  assert.deepEqual(migrated?.notificationCategories, ThreadNotificationModel.categoriesForLegacyDesktopNotifications())
  assert.equal(migrated?.desktopNotificationsEnabled, false)

  const custom = {
    ...DEFAULT_PREFERENCES,
    desktopNotificationsEnabled: true,
    notificationCategories: {
      ...DEFAULT_PREFERENCES.notificationCategories,
      'approval-needed': { ...DEFAULT_PREFERENCES.notificationCategories['approval-needed'], delivery: 'in-app' },
    },
  }
  assert.deepEqual(SidebarPreferencesModel.decode(custom)?.notificationCategories, custom.notificationCategories)
})

test('malformed notification categories reject Host preferences rather than reaching the sidebar', () => {
  const invalid = {
    ...DEFAULT_PREFERENCES,
    notificationCategories: {
      ...DEFAULT_PREFERENCES.notificationCategories,
      'approval-needed': { ...DEFAULT_PREFERENCES.notificationCategories['approval-needed'], delivery: 'email', volume: 2 },
    },
  }
  assert.equal(SidebarPreferencesModel.decode(invalid), null)
})

test('legacy local alert settings migrate into Host preferences without overriding customized routes', () => {
  const local = { ...DEFAULT_PREFERENCES, desktopNotificationsEnabled: true }
  const migrated = SidebarPreferencesModel.preferencesToMigrate(local, DEFAULT_PREFERENCES)
  assert.deepEqual(migrated.notificationCategories, ThreadNotificationModel.categoriesForLegacyDesktopNotifications())
  assert.equal(migrated.desktopNotificationsEnabled, false)
})

test('older preferences show every thread-row hover action', () => {
  const { hiddenRowActions, ...older } = DEFAULT_PREFERENCES
  assert.deepEqual(hiddenRowActions, [])
  assert.deepEqual(SidebarPreferencesModel.decode(older)?.hiddenRowActions, [])
  assert.deepEqual(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, hiddenRowActions: ['aside', 'mute'] })?.hiddenRowActions, ['aside', 'mute'])
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, hiddenRowActions: ['aside', 'nope'] }), null)
})

test('older preferences order every thread-row hover action with settle in archive slot', () => {
  const { rowActionOrder, ...older } = DEFAULT_PREFERENCES
  assert.deepEqual(rowActionOrder, ['resume', 'resumeDismiss', 'aside', 'pin', 'park', 'mute', 'archive', 'settle', 'restore'])
  assert.deepEqual(SidebarPreferencesModel.decode(older)?.rowActionOrder, rowActionOrder)
  const reordered = ['pin', 'aside', 'resume']
  assert.deepEqual(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, rowActionOrder: reordered })?.rowActionOrder, [
    'pin',
    'aside',
    'resume',
    'resumeDismiss',
    'park',
    'settle',
    'mute',
    'archive',
    'restore',
  ])
  assert.deepEqual(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, rowActionOrder: ['pin', 'pin'] })?.rowActionOrder, [
    'pin',
    'resume',
    'resumeDismiss',
    'aside',
    'park',
    'settle',
    'mute',
    'archive',
    'restore',
  ])
  assert.equal(SidebarPreferencesModel.decode({ ...DEFAULT_PREFERENCES, rowActionOrder: ['pin', 'nope'] }), null)
})
