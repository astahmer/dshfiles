import assert from 'node:assert/strict'
import { test } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { decodePreferences, preferencesToMigrate } from './preferences.js'
import { categoriesForLegacyDesktopNotifications } from './thread-notifications.js'

test('older stored preferences default the header and thread split to natural height', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: undefined })
  assert.ok(stored)
  assert.equal(decodePreferences(JSON.parse(stored))?.headerRegionHeight, null)
})

test('older preferences gain attention modes and default child-thread actions to enabled', () => {
  const { approvalNeededDisplay, inputNeededDisplay, turnFinishedDisplay, includeSubagentAttention, applyActionsToChildThreads, ...older } = DEFAULT_PREFERENCES
  const parsed = decodePreferences(older)
  assert.ok(parsed)
  assert.deepEqual(
    [parsed.approvalNeededDisplay, parsed.inputNeededDisplay, parsed.turnFinishedDisplay, parsed.includeSubagentAttention],
    [approvalNeededDisplay, inputNeededDisplay, turnFinishedDisplay, includeSubagentAttention],
  )
  assert.equal(applyActionsToChildThreads, true)
  assert.equal(parsed.applyActionsToChildThreads, true)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, applyActionsToChildThreads: false })?.applyActionsToChildThreads, false)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, turnFinishedDisplay: 'section' }), null)
})

test('older preferences default rebase-triggered auto-archive to disabled', () => {
  const { rebasedThreadArchiveDelay, ...older } = DEFAULT_PREFERENCES
  assert.equal(rebasedThreadArchiveDelay, 'disabled')
  assert.equal(decodePreferences(older)?.rebasedThreadArchiveDelay, 'disabled')
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, rebasedThreadArchiveDelay: 'after-1-day' })?.rebasedThreadArchiveDelay, 'after-1-day')
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, rebasedThreadArchiveDelay: 'after-5-minutes' }), null)
})

test('archive undo defaults on and rejects durations outside one through thirty seconds', () => {
  const { archiveUndoEnabled, archiveUndoDurationSeconds, ...older } = DEFAULT_PREFERENCES
  const parsed = decodePreferences(older)

  assert.ok(parsed)
  assert.equal(parsed.archiveUndoEnabled, archiveUndoEnabled)
  assert.equal(parsed.archiveUndoDurationSeconds, archiveUndoDurationSeconds)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, archiveUndoEnabled: false })?.archiveUndoEnabled, false)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, archiveUndoDurationSeconds: 1 })?.archiveUndoDurationSeconds, 1)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, archiveUndoDurationSeconds: 30 })?.archiveUndoDurationSeconds, 30)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, archiveUndoDurationSeconds: 0 }), null)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, archiveUndoDurationSeconds: 31 }), null)
})

test('older preferences default per-thread auto-archive overrides to inherit global behavior', () => {
  const { autoArchiveSessionIds, autoArchiveDisabledSessionIds, ...older } = DEFAULT_PREFERENCES
  assert.deepEqual(autoArchiveSessionIds, [])
  assert.deepEqual(autoArchiveDisabledSessionIds, [])
  assert.deepEqual(decodePreferences(older)?.autoArchiveSessionIds, [])
  assert.deepEqual(decodePreferences(older)?.autoArchiveDisabledSessionIds, [])
  const saved = decodePreferences({
    ...DEFAULT_PREFERENCES,
    autoArchiveSessionIds: ['enabled-thread'],
    autoArchiveDisabledSessionIds: ['disabled-thread'],
  })
  assert.deepEqual(saved?.autoArchiveSessionIds, ['enabled-thread'])
  assert.deepEqual(saved?.autoArchiveDisabledSessionIds, ['disabled-thread'])
})

test('valid saved split heights persist and invalid heights are rejected', () => {
  const stored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: 384 })
  const invalidStored = JSON.stringify({ ...DEFAULT_PREFERENCES, headerRegionHeight: 24 })

  assert.equal(decodePreferences(JSON.parse(stored))?.headerRegionHeight, 384)
  assert.equal(decodePreferences(JSON.parse(invalidStored)), null)
})

test('preferences saved before navigation and palette settings existed gain their defaults', () => {
  const { navigationDensity, navigationOverflow, paletteChord, threadSearchChord, paletteRecentLimit, ...older } = DEFAULT_PREFERENCES
  const parsed = decodePreferences({ ...older, headerMode: 'expanded' })
  assert.ok(parsed)
  assert.equal(parsed.headerMode, 'expanded')
  assert.deepEqual(
    [parsed.navigationDensity, parsed.navigationOverflow, parsed.paletteChord, parsed.threadSearchChord, parsed.paletteRecentLimit],
    [navigationDensity, navigationOverflow, paletteChord, threadSearchChord, paletteRecentLimit],
  )
})

test('a disabled chord persists as null', () => {
  assert.equal(decodePreferences(JSON.parse(JSON.stringify({ ...DEFAULT_PREFERENCES, paletteChord: null })))?.paletteChord, null)
})

test('migration copies browser values only into Host keys still at their default', () => {
  const local = { ...DEFAULT_PREFERENCES, headerMode: 'expanded' as const, idleMinutes: 300, footerOrder: ['settings'] }
  const host = { ...DEFAULT_PREFERENCES, idleMinutes: 60 }
  assert.deepEqual(preferencesToMigrate(local, host), { headerMode: 'expanded', footerOrder: ['settings'] })
  assert.deepEqual(preferencesToMigrate(DEFAULT_PREFERENCES, host), {})
})

test('Host settings values decode through the sidebar contract', () => {
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, headerMode: 'diagonal' }), null)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, headerRegionHeight: 200 })?.headerRegionHeight, 200)
})

test('older settings gain default attention colors and reject unknown semantic colors', () => {
  const { attentionColors, ...older } = DEFAULT_PREFERENCES
  assert.deepEqual(decodePreferences(older)?.attentionColors, attentionColors)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, attentionColors: { ...attentionColors, turnFinished: 'neon' } }), null)
})

test('attention colors migrate only when the Host still has defaults', () => {
  const local = { ...DEFAULT_PREFERENCES, attentionColors: { ...DEFAULT_PREFERENCES.attentionColors, turnFinished: 'warning' as const } }
  const host = { ...DEFAULT_PREFERENCES }
  assert.deepEqual(preferencesToMigrate(local, host), { attentionColors: local.attentionColors })
})

test('a Host namespace from before the brand-logo setting keeps the logo shown', () => {
  const { hideBrandLogo, ...older } = DEFAULT_PREFERENCES
  assert.equal(hideBrandLogo, false)
  assert.equal(decodePreferences(older)?.hideBrandLogo, false)
  assert.equal(decodePreferences({ ...older, hideBrandLogo: true })?.hideBrandLogo, true)
})

test('settings saved before the finished-subagents choice collapse them and reject unknown modes', () => {
  const { finishedSubagents, ...older } = DEFAULT_PREFERENCES
  assert.equal(decodePreferences(older)?.finishedSubagents, finishedSubagents)
  assert.equal(finishedSubagents, 'collapse')
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, finishedSubagents: 'archive' }), null)
})

test('the saved thread views live in the Host-synced preferences', () => {
  assert.deepEqual(decodePreferences(DEFAULT_PREFERENCES)?.threadViews, DEFAULT_PREFERENCES.threadViews)
  const custom = { ...DEFAULT_PREFERENCES.threadViews, activeViewId: 'working' }
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, threadViews: custom })?.threadViews.activeViewId, 'working')
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, threadViews: { ...custom, views: [] } }), null)
  assert.equal(decodePreferences({ ...DEFAULT_PREFERENCES, threadViews: { views: [{ id: 'x' }], activeViewId: 'x' } }), null)
})

test('legacy desktop alerts migrate to per-category system delivery unless the new setting is customized', () => {
  const { notificationCategories: _notificationCategories, ...legacyPreferences } = DEFAULT_PREFERENCES
  const migrated = decodePreferences({ ...legacyPreferences, desktopNotificationsEnabled: true })
  assert.deepEqual(migrated?.notificationCategories, categoriesForLegacyDesktopNotifications())
  assert.equal(migrated?.desktopNotificationsEnabled, false)

  const custom = {
    ...DEFAULT_PREFERENCES,
    desktopNotificationsEnabled: true,
    notificationCategories: {
      ...DEFAULT_PREFERENCES.notificationCategories,
      'approval-needed': { ...DEFAULT_PREFERENCES.notificationCategories['approval-needed'], delivery: 'in-app' },
    },
  }
  assert.deepEqual(decodePreferences(custom)?.notificationCategories, custom.notificationCategories)
})

test('malformed notification categories reject Host preferences rather than reaching the sidebar', () => {
  const invalid = {
    ...DEFAULT_PREFERENCES,
    notificationCategories: {
      ...DEFAULT_PREFERENCES.notificationCategories,
      'approval-needed': { ...DEFAULT_PREFERENCES.notificationCategories['approval-needed'], delivery: 'email', volume: 2 },
    },
  }
  assert.equal(decodePreferences(invalid), null)
})

test('legacy local alert settings migrate into Host preferences without overriding customized routes', () => {
  const local = { ...DEFAULT_PREFERENCES, desktopNotificationsEnabled: true }
  const migrated = preferencesToMigrate(local, DEFAULT_PREFERENCES)
  assert.deepEqual(migrated.notificationCategories, categoriesForLegacyDesktopNotifications())
  assert.equal(migrated.desktopNotificationsEnabled, false)
})
