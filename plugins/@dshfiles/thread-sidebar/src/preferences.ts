import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import * as Schema from 'effect/Schema'
import * as SchemaGetter from 'effect/SchemaGetter'
import * as Option from 'effect/Option'
import { threadMutesSchema } from './thread-mute.js'
import {
  ATTENTION_COLOR_OPTIONS,
  PROJECT_COLOR_PALETTES,
  DEFAULT_PREFERENCES,
  SIDEBAR_ORDER_SECTIONS,
  SIDEBAR_SECTIONS,
  SidebarOrganization,
  THREAD_ROW_ACTIONS,
  type SidebarPreferences,
  type SidebarSection,
} from './organization.js'
import { THREAD_DELAYS } from './thread-delays.js'
import { threadViewSettingsSchema } from './thread-view-preferences.js'
import {
  DEFAULT_THREAD_NOTIFICATION_CATEGORIES,
  THREAD_NOTIFICATION_PLACEMENTS,
  ThreadNotificationModel,
  threadNotificationCategoriesSchema,
} from './thread-notifications.js'
import { SchemaHelpers } from './schema-helpers.js'

export const PREFERENCES_STORAGE_KEY = 'dshfiles.thread-sidebar.v1'

const sidebarSectionSchema = Schema.Literals(SIDEBAR_SECTIONS)
const sidebarOrderSectionSchema = Schema.Literals(SIDEBAR_ORDER_SECTIONS)
const threadRowActionSchema = Schema.Literals(THREAD_ROW_ACTIONS)
export const attentionColorSchema = Schema.Literals(ATTENTION_COLOR_OPTIONS)
const projectColorPaletteSchema = Schema.Literals(PROJECT_COLOR_PALETTES)

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

const preferenceDocumentSchema = Schema.Record(Schema.String, Schema.Unknown)

const upgradeLegacyPreferenceKeys = (value: unknown): unknown => {
  const parsed = Schema.decodeUnknownOption(preferenceDocumentSchema)(value)
  // Anything that is not a preferences document is left to the strict schema, which rejects it.
  if (Option.isNone(parsed)) return value
  const upgraded: Record<string, unknown> = { ...parsed.value }
  for (const [legacy, current] of Object.entries(legacyPreferenceRenames)) {
    if (!(legacy in upgraded)) continue
    if (upgraded[current] === undefined) upgraded[current] = upgraded[legacy]
    delete upgraded[legacy]
  }
  return upgraded
}

const preferencesInputFields = {
  archiveUndoEnabled: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.archiveUndoEnabled),
  archiveUndoDurationSeconds: SchemaHelpers.withDecodedDefault(
    Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(30)),
    () => DEFAULT_PREFERENCES.archiveUndoDurationSeconds,
  ),
  autoSettleEnabled: Schema.Boolean,
  rebasedThreadSettleDelay: SchemaHelpers.withDecodedDefault(Schema.Literals(THREAD_DELAYS), () => DEFAULT_PREFERENCES.rebasedThreadSettleDelay),
  settledArchiveDelay: SchemaHelpers.withDecodedDefault(Schema.Literals(THREAD_DELAYS), () => DEFAULT_PREFERENCES.settledArchiveDelay),
  idleMinutes: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(15)).check(Schema.isLessThanOrEqualTo(10080)),
  scanIntervalMinutes: Schema.Number.check(Schema.isFinite())
    .check(Schema.isInt())
    .check(Schema.isGreaterThanOrEqualTo(1))
    .check(Schema.isLessThanOrEqualTo(120)),
  excludedWorkspaceIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(500)),
  excludedSessionIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(5000)),
  autoSettleSessionIds: SchemaHelpers.withDecodedDefault(
    Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(5000)),
    () => DEFAULT_PREFERENCES.autoSettleSessionIds,
  ),
  autoSettleDisabledSessionIds: SchemaHelpers.withDecodedDefault(
    Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(5000)),
    () => DEFAULT_PREFERENCES.autoSettleDisabledSessionIds,
  ),
  parkedSessionIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(5000)),
  settledSessionIds: SchemaHelpers.withDecodedDefault(
    Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(5000)),
    () => DEFAULT_PREFERENCES.settledSessionIds,
  ),
  settledAt: SchemaHelpers.withDecodedDefault(
    Schema.Record(Schema.String, Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0))),
    () => DEFAULT_PREFERENCES.settledAt,
  ),
  mutedThreads: SchemaHelpers.withDecodedDefault(threadMutesSchema, () => DEFAULT_PREFERENCES.mutedThreads),
  collapsedSections: Schema.mutable(Schema.Array(sidebarSectionSchema)).check(Schema.isMaxLength(SIDEBAR_SECTIONS.length)),
  collapsedGroups: SchemaHelpers.withDecodedDefault(
    Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(200)))).check(Schema.isMaxLength(200)),
    () => DEFAULT_PREFERENCES.collapsedGroups,
  ),
  sectionOrder: SchemaHelpers.withDecodedDefault(
    Schema.mutable(Schema.Array(sidebarOrderSectionSchema))
      .check(Schema.isMaxLength(SIDEBAR_ORDER_SECTIONS.length))
      .pipe(
        Schema.decodeTo(Schema.mutable(Schema.Array(sidebarOrderSectionSchema)), {
          decode: SchemaGetter.transform(order => SidebarOrganization.orderSections(order)),
          encode: SchemaGetter.transform(order => order),
        }),
      ),
    (): SidebarPreferences['sectionOrder'] => [...DEFAULT_PREFERENCES.sectionOrder],
  ),
  separateRemoteThreads: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.separateRemoteThreads),
  idleSectionOverrides: SchemaHelpers.withDecodedDefault(
    Schema.Record(
      Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)),
      SchemaHelpers.strictStruct(
        Schema.Struct({
          section: Schema.Literals(['active', 'inactive']),
          at: Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)),
        }),
      ),
    ),
    () => DEFAULT_PREFERENCES.idleSectionOverrides,
  ),
  workspaceFilter: SchemaHelpers.withDecodedDefault(Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))), () => DEFAULT_PREFERENCES.workspaceFilter),
  headerMode: Schema.Literals(['compact', 'expanded']),
  hideBrandLogo: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.hideBrandLogo),
  headerRegionHeight: SchemaHelpers.withDecodedDefault(
    Schema.NullOr(
      Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(40)).check(Schema.isLessThanOrEqualTo(10000)),
    ),
    () => null,
  ),
  headerOrder: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(300)),
  hiddenHeaderIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(300)),
  footerOrder: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(300)),
  hiddenFooterIds: Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(256)))).check(Schema.isMaxLength(300)),
  navigationDensity: SchemaHelpers.withDecodedDefault(Schema.Literals(['compact', 'comfortable']), () => DEFAULT_PREFERENCES.navigationDensity),
  navigationOverflow: SchemaHelpers.withDecodedDefault(Schema.Literals(['scroll', 'menu', 'scroll-menu']), () => DEFAULT_PREFERENCES.navigationOverflow),
  paletteChord: SchemaHelpers.withDecodedDefault(Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))), () => DEFAULT_PREFERENCES.paletteChord),
  fileSearchChord: SchemaHelpers.withDecodedDefault(Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))), () => DEFAULT_PREFERENCES.fileSearchChord),
  threadSearchChord: SchemaHelpers.withDecodedDefault(Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))), () => DEFAULT_PREFERENCES.threadSearchChord),
  backChord: SchemaHelpers.withDecodedDefault(Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))), () => DEFAULT_PREFERENCES.backChord),
  forwardChord: SchemaHelpers.withDecodedDefault(Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))), () => DEFAULT_PREFERENCES.forwardChord),
  paletteRecentLimit: SchemaHelpers.withDecodedDefault(
    Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(5)).check(Schema.isLessThanOrEqualTo(100)),
    () => DEFAULT_PREFERENCES.paletteRecentLimit,
  ),
  threadRowDensity: SchemaHelpers.withDecodedDefault(Schema.Literals(['compact', 'comfortable']), () => DEFAULT_PREFERENCES.threadRowDensity),
  threadRowProject: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.threadRowProject),
  threadRowProjectColor: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.threadRowProjectColor),
  projectColorPalette: SchemaHelpers.withDecodedDefault(projectColorPaletteSchema, () => DEFAULT_PREFERENCES.projectColorPalette),
  threadRowTitle: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.threadRowTitle),
  threadRowMachine: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.threadRowMachine),
  threadRowPath: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.threadRowPath),
  threadRowTime: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.threadRowTime),
  threadRowStatusDot: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.threadRowStatusDot),
  arrowKeysSwitchThread: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.arrowKeysSwitchThread),
  hiddenRowActions: SchemaHelpers.withDecodedDefault(
    Schema.mutable(Schema.Array(threadRowActionSchema)).check(Schema.isMaxLength(THREAD_ROW_ACTIONS.length)),
    () => DEFAULT_PREFERENCES.hiddenRowActions,
  ),
  rowActionOrder: SchemaHelpers.withDecodedDefault(
    Schema.mutable(Schema.Array(threadRowActionSchema))
      .check(Schema.isMaxLength(THREAD_ROW_ACTIONS.length))
      .pipe(
        Schema.decodeTo(Schema.mutable(Schema.Array(threadRowActionSchema)), {
          decode: SchemaGetter.transform(order => SidebarOrganization.orderRowActions(order)),
          encode: SchemaGetter.transform(order => order),
        }),
      ),
    (): SidebarPreferences['rowActionOrder'] => [...DEFAULT_PREFERENCES.rowActionOrder],
  ),
  approvalNeededDisplay: SchemaHelpers.withDecodedDefault(Schema.Literals(['group', 'label']), () => DEFAULT_PREFERENCES.approvalNeededDisplay),
  inputNeededDisplay: SchemaHelpers.withDecodedDefault(Schema.Literals(['group', 'label']), () => DEFAULT_PREFERENCES.inputNeededDisplay),
  turnFinishedDisplay: SchemaHelpers.withDecodedDefault(Schema.Literals(['group', 'label']), () => DEFAULT_PREFERENCES.turnFinishedDisplay),
  attentionColors: SchemaHelpers.withDecodedDefault(
    SchemaHelpers.strictStruct(
      Schema.Struct({
        approvalNeeded: attentionColorSchema,
        inputNeeded: attentionColorSchema,
        turnFinished: attentionColorSchema,
      }),
    ),
    () => DEFAULT_PREFERENCES.attentionColors,
  ),
  includeSubagentAttention: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.includeSubagentAttention),
  desktopNotificationsEnabled: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.desktopNotificationsEnabled),
  notificationCategories: Schema.optional(threadNotificationCategoriesSchema),
  notificationPlacement: SchemaHelpers.withDecodedDefault(Schema.Literals(THREAD_NOTIFICATION_PLACEMENTS), () => DEFAULT_PREFERENCES.notificationPlacement),
  notificationDurationSeconds: SchemaHelpers.withDecodedDefault(
    Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(0)).check(Schema.isLessThanOrEqualTo(60)),
    () => DEFAULT_PREFERENCES.notificationDurationSeconds,
  ),
  applyActionsToChildThreads: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.applyActionsToChildThreads),
  resumeAfterRestart: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => DEFAULT_PREFERENCES.resumeAfterRestart),
  maxChildren: SchemaHelpers.withDecodedDefault(
    Schema.Number.check(Schema.isFinite()).check(Schema.isInt()).check(Schema.isGreaterThanOrEqualTo(1)).check(Schema.isLessThanOrEqualTo(50)),
    () => DEFAULT_PREFERENCES.maxChildren,
  ),
  finishedSubagents: SchemaHelpers.withDecodedDefault(Schema.Literals(['show', 'collapse', 'hide']), () => DEFAULT_PREFERENCES.finishedSubagents),
  threadViews: SchemaHelpers.withDecodedDefault(threadViewSettingsSchema, () => DEFAULT_PREFERENCES.threadViews),
}

const preferencesInputSchema = SchemaHelpers.strictStruct(Schema.Struct(preferencesInputFields))

const preferencesSchema = Schema.Struct({
  ...preferencesInputFields,
  notificationCategories: SchemaHelpers.withDecodedDefault(threadNotificationCategoriesSchema, () => DEFAULT_THREAD_NOTIFICATION_CATEGORIES),
})

const storedPreferencesSchema = Schema.Unknown.pipe(
  Schema.decodeTo(preferencesSchema, {
    decode: SchemaGetter.transform(value => {
      const upgraded = upgradeLegacyPreferenceKeys(value)
      // SAFETY: the target Struct validates the migrated value after this adapter.
      return upgraded as Schema.Struct.Encoded<typeof preferencesSchema.fields>
    }),
    encode: SchemaGetter.transform(value => value),
  }),
)

/** Decode a Host settings value; null when it does not satisfy the sidebar contract. */
const decodePreferences = (value: unknown): SidebarPreferences | null => {
  const checked = Schema.decodeUnknownOption(preferencesInputSchema)(upgradeLegacyPreferenceKeys(value))
  if (Option.isNone(checked)) return null
  const categoriesStillDefault =
    checked.value.notificationCategories === undefined ||
    JSON.stringify(checked.value.notificationCategories) === JSON.stringify(DEFAULT_THREAD_NOTIFICATION_CATEGORIES)
  const migrateDesktopNotifications = checked.value.desktopNotificationsEnabled && categoriesStillDefault
  return {
    ...checked.value,
    desktopNotificationsEnabled: migrateDesktopNotifications ? false : checked.value.desktopNotificationsEnabled,
    notificationCategories: migrateDesktopNotifications
      ? ThreadNotificationModel.categoriesForLegacyDesktopNotifications()
      : (checked.value.notificationCategories ?? DEFAULT_THREAD_NOTIFICATION_CATEGORIES),
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
  schema: storedPreferencesSchema,
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
