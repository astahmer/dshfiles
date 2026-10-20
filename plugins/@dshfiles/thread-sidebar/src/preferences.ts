import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { threadMutesSchema } from './thread-mute.js'
import {
  ATTENTION_COLOR_OPTIONS,
  DEFAULT_PREFERENCES,
  SIDEBAR_SECTIONS,
  SidebarOrganization,
  THREAD_ROW_ACTIONS,
  type SidebarPreferences,
  type SidebarSection,
} from './organization.js'
import { THREAD_DELAYS } from './thread-delays.js'
import { threadViewSettingsSchema } from './thread-view-preferences.js'
import { DEFAULT_THREAD_NOTIFICATION_CATEGORIES, ThreadNotificationModel, threadNotificationCategoriesSchema } from './thread-notifications.js'

export const PREFERENCES_STORAGE_KEY = 'dshfiles.thread-sidebar.v1'

const sidebarSectionSchema = z.enum(SIDEBAR_SECTIONS)
const threadRowActionSchema = z.enum(THREAD_ROW_ACTIONS)
export const attentionColorSchema = z.enum(ATTENTION_COLOR_OPTIONS)

/**
 * Auto-archive became auto-settle: the same idle scan now writes our own soft status instead of the
 * native archive verb. A stored document from before the rename still carries the old keys, so map
 * them onto the current field names and drop the legacy ones before the strict parse.
 */
const legacyPreferenceRenames = {
  autoArchiveEnabled: 'autoSettleEnabled',
  autoArchiveSessionIds: 'autoSettleSessionIds',
  autoArchiveDisabledSessionIds: 'autoSettleDisabledSessionIds',
  rebasedThreadArchiveDelay: 'rebasedThreadSettleDelay',
} as const

const preferenceDocumentSchema = z.record(z.string(), z.unknown())

const upgradeLegacyPreferenceKeys = (value: unknown): unknown => {
  const parsed = preferenceDocumentSchema.safeParse(value)
  // Anything that is not a preferences document is left to the strict schema, which rejects it.
  if (!parsed.success) return value
  const upgraded: Record<string, unknown> = { ...parsed.data }
  for (const [legacy, current] of Object.entries(legacyPreferenceRenames)) {
    if (!(legacy in upgraded)) continue
    if (upgraded[current] === undefined) upgraded[current] = upgraded[legacy]
    delete upgraded[legacy]
  }
  return upgraded
}

const preferencesInputSchema = z
  .object({
    archiveUndoEnabled: z.boolean().default(DEFAULT_PREFERENCES.archiveUndoEnabled),
    archiveUndoDurationSeconds: z.number().int().min(1).max(30).default(DEFAULT_PREFERENCES.archiveUndoDurationSeconds),
    autoSettleEnabled: z.boolean(),
    rebasedThreadSettleDelay: z.enum(THREAD_DELAYS).default(DEFAULT_PREFERENCES.rebasedThreadSettleDelay),
    settledArchiveDelay: z.enum(THREAD_DELAYS).default(DEFAULT_PREFERENCES.settledArchiveDelay),
    idleMinutes: z.number().int().min(15).max(10080),
    scanIntervalMinutes: z.number().int().min(1).max(120),
    excludedWorkspaceIds: z.array(z.string().min(1).max(256)).max(500),
    excludedSessionIds: z.array(z.string().min(1).max(256)).max(5000),
    autoSettleSessionIds: z.array(z.string().min(1).max(256)).max(5000).default(DEFAULT_PREFERENCES.autoSettleSessionIds),
    autoSettleDisabledSessionIds: z.array(z.string().min(1).max(256)).max(5000).default(DEFAULT_PREFERENCES.autoSettleDisabledSessionIds),
    parkedSessionIds: z.array(z.string().min(1).max(256)).max(5000),
    settledSessionIds: z.array(z.string().min(1).max(256)).max(5000).default(DEFAULT_PREFERENCES.settledSessionIds),
    settledAt: z.record(z.string(), z.number().int().nonnegative()).default(DEFAULT_PREFERENCES.settledAt),
    mutedThreads: threadMutesSchema.default(DEFAULT_PREFERENCES.mutedThreads),
    collapsedSections: z.array(sidebarSectionSchema).max(SIDEBAR_SECTIONS.length),
    collapsedGroups: z.array(z.string().min(1).max(200)).max(200).default(DEFAULT_PREFERENCES.collapsedGroups),
    sectionOrder: z
      .array(sidebarSectionSchema)
      .max(SIDEBAR_SECTIONS.length)
      .default([...DEFAULT_PREFERENCES.sectionOrder])
      .transform(order => SidebarOrganization.orderSections(order)),
    idleSectionOverrides: z
      .record(z.string().min(1).max(256), z.object({ section: z.enum(['active', 'inactive']), at: z.number().int().nonnegative() }).strict())
      .default(DEFAULT_PREFERENCES.idleSectionOverrides),
    workspaceFilter: z.string().max(256).nullable().default(DEFAULT_PREFERENCES.workspaceFilter),
    headerMode: z.enum(['compact', 'expanded']),
    hideBrandLogo: z.boolean().default(DEFAULT_PREFERENCES.hideBrandLogo),
    headerRegionHeight: z.number().int().min(40).max(10000).nullable().default(null),
    headerOrder: z.array(z.string().min(1).max(256)).max(300),
    hiddenHeaderIds: z.array(z.string().min(1).max(256)).max(300),
    footerOrder: z.array(z.string().min(1).max(256)).max(300),
    hiddenFooterIds: z.array(z.string().min(1).max(256)).max(300),
    navigationDensity: z.enum(['compact', 'comfortable']).default(DEFAULT_PREFERENCES.navigationDensity),
    navigationOverflow: z.enum(['scroll', 'menu', 'scroll-menu']).default(DEFAULT_PREFERENCES.navigationOverflow),
    paletteChord: z.string().max(64).nullable().default(DEFAULT_PREFERENCES.paletteChord),
    fileSearchChord: z.string().max(64).nullable().default(DEFAULT_PREFERENCES.fileSearchChord),
    threadSearchChord: z.string().max(64).nullable().default(DEFAULT_PREFERENCES.threadSearchChord),
    backChord: z.string().max(64).nullable().default(DEFAULT_PREFERENCES.backChord),
    forwardChord: z.string().max(64).nullable().default(DEFAULT_PREFERENCES.forwardChord),
    paletteRecentLimit: z.number().int().min(5).max(100).default(DEFAULT_PREFERENCES.paletteRecentLimit),
    threadRowDensity: z.enum(['compact', 'comfortable']).default(DEFAULT_PREFERENCES.threadRowDensity),
    threadRowProject: z.boolean().default(DEFAULT_PREFERENCES.threadRowProject),
    threadRowProjectColor: z.boolean().default(DEFAULT_PREFERENCES.threadRowProjectColor),
    threadRowTitle: z.boolean().default(DEFAULT_PREFERENCES.threadRowTitle),
    threadRowMachine: z.boolean().default(DEFAULT_PREFERENCES.threadRowMachine),
    threadRowPath: z.boolean().default(DEFAULT_PREFERENCES.threadRowPath),
    threadRowTime: z.boolean().default(DEFAULT_PREFERENCES.threadRowTime),
    threadRowStatusDot: z.boolean().default(DEFAULT_PREFERENCES.threadRowStatusDot),
    arrowKeysSwitchThread: z.boolean().default(DEFAULT_PREFERENCES.arrowKeysSwitchThread),
    hiddenRowActions: z.array(threadRowActionSchema).max(THREAD_ROW_ACTIONS.length).default(DEFAULT_PREFERENCES.hiddenRowActions),
    rowActionOrder: z
      .array(threadRowActionSchema)
      .max(THREAD_ROW_ACTIONS.length)
      .default([...DEFAULT_PREFERENCES.rowActionOrder])
      .transform(order => SidebarOrganization.orderRowActions(order)),
    approvalNeededDisplay: z.enum(['group', 'label']).default(DEFAULT_PREFERENCES.approvalNeededDisplay),
    inputNeededDisplay: z.enum(['group', 'label']).default(DEFAULT_PREFERENCES.inputNeededDisplay),
    turnFinishedDisplay: z.enum(['group', 'label']).default(DEFAULT_PREFERENCES.turnFinishedDisplay),
    attentionColors: z
      .object({
        approvalNeeded: attentionColorSchema,
        inputNeeded: attentionColorSchema,
        turnFinished: attentionColorSchema,
      })
      .strict()
      .default(DEFAULT_PREFERENCES.attentionColors),
    includeSubagentAttention: z.boolean().default(DEFAULT_PREFERENCES.includeSubagentAttention),
    desktopNotificationsEnabled: z.boolean().default(DEFAULT_PREFERENCES.desktopNotificationsEnabled),
    notificationCategories: threadNotificationCategoriesSchema.optional(),
    applyActionsToChildThreads: z.boolean().default(DEFAULT_PREFERENCES.applyActionsToChildThreads),
    maxChildren: z.number().int().min(1).max(50).default(DEFAULT_PREFERENCES.maxChildren),
    finishedSubagents: z.enum(['show', 'collapse', 'hide']).default(DEFAULT_PREFERENCES.finishedSubagents),
    threadViews: threadViewSettingsSchema.default(DEFAULT_PREFERENCES.threadViews),
  })
  .strict()

const preferencesSchema = preferencesInputSchema.extend({
  notificationCategories: threadNotificationCategoriesSchema.default(DEFAULT_THREAD_NOTIFICATION_CATEGORIES),
})

/** Decode a Host settings value; null when it does not satisfy the sidebar contract. */
const decodePreferences = (value: unknown): SidebarPreferences | null => {
  const checked = preferencesInputSchema.safeParse(upgradeLegacyPreferenceKeys(value))
  if (!checked.success) return null
  const categoriesStillDefault =
    checked.data.notificationCategories === undefined ||
    JSON.stringify(checked.data.notificationCategories) === JSON.stringify(DEFAULT_THREAD_NOTIFICATION_CATEGORIES)
  const migrateDesktopNotifications = checked.data.desktopNotificationsEnabled && categoriesStillDefault
  return {
    ...checked.data,
    desktopNotificationsEnabled: migrateDesktopNotifications ? false : checked.data.desktopNotificationsEnabled,
    notificationCategories: migrateDesktopNotifications
      ? ThreadNotificationModel.categoriesForLegacyDesktopNotifications()
      : (checked.data.notificationCategories ?? DEFAULT_THREAD_NOTIFICATION_CATEGORIES),
  }
}

/**
 * Browser values to copy into Host settings once: only keys the Host still holds
 * at their default, so another device's choices are never overwritten.
 */
const preferencesToMigrate = (local: SidebarPreferences, host: SidebarPreferences): Partial<SidebarPreferences> => {
  const patch: Partial<SidebarPreferences> = {}
  for (const key of Object.keys(DEFAULT_PREFERENCES).filter(isPreferenceKey)) {
    const same = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right)
    if (same(host[key], DEFAULT_PREFERENCES[key]) && !same(local[key], host[key])) Object.assign(patch, { [key]: local[key] })
  }
  const legacyCategoriesUnchanged = JSON.stringify(local.notificationCategories) === JSON.stringify(DEFAULT_THREAD_NOTIFICATION_CATEGORIES)
  const hostCategoriesUnchanged = JSON.stringify(host.notificationCategories) === JSON.stringify(DEFAULT_THREAD_NOTIFICATION_CATEGORIES)
  if (local.desktopNotificationsEnabled && legacyCategoriesUnchanged && hostCategoriesUnchanged) {
    patch.notificationCategories = ThreadNotificationModel.categoriesForLegacyDesktopNotifications()
    patch.desktopNotificationsEnabled = false
  }
  return patch
}

const isPreferenceKey = (key: string): key is keyof SidebarPreferences => key in DEFAULT_PREFERENCES

/** Browser copy used only while the Host settings namespace is unavailable; null when absent or invalid. */
export const storedPreferences = createStoredValue({
  key: PREFERENCES_STORAGE_KEY,
  schema: z.preprocess(upgradeLegacyPreferenceKeys, preferencesSchema),
  fallback: null,
})

const toggleCollapsedSection = (collapsedSections: readonly SidebarSection[], section: SidebarSection): SidebarSection[] =>
  collapsedSections.includes(section) ? collapsedSections.filter(item => item !== section) : [...collapsedSections, section]

export class SidebarPreferencesModel {
  static readonly decode = decodePreferences
  static readonly isPreferenceKey = isPreferenceKey
  static readonly preferencesToMigrate = preferencesToMigrate
  static readonly toggleCollapsedSection = toggleCollapsedSection
}
