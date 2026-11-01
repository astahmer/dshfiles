import { createEffectStoredValue } from './effect-stored-value.js'
import * as Schema from 'effect/Schema'
import type { AttentionFinishReason, ThreadAttentionMigrationEntry } from './attention-api.js'
import { SchemaHelpers } from './schema-helpers.js'

export const THREAD_NOTIFICATION_CATEGORIES = ['approval-needed', 'input-needed', 'turn-finished', 'stopped', 'failed'] as const
export type ThreadNotificationCategory = (typeof THREAD_NOTIFICATION_CATEGORIES)[number]
/** The categories a finished turn can land in; approvals and questions come from pending interactions. */
const THREAD_FINISH_NOTIFICATION_CATEGORIES = ['turn-finished', 'stopped', 'failed'] as const
export type ThreadFinishNotificationCategory = (typeof THREAD_FINISH_NOTIFICATION_CATEGORIES)[number]
export type ThreadNotificationDelivery = 'off' | 'in-app' | 'system' | 'both'
export const THREAD_NOTIFICATION_PLACEMENTS = ['top-left', 'top-center', 'top-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const
export type ThreadNotificationPlacement = (typeof THREAD_NOTIFICATION_PLACEMENTS)[number]
export type ThreadNotificationSound = 'soft' | 'chime' | 'bright' | 'low'

export interface ThreadNotificationCategoryPreferences {
  readonly delivery: ThreadNotificationDelivery
  readonly sound: boolean
  readonly soundPreset: ThreadNotificationSound
  readonly volume: number
}

export type ThreadNotificationCategories = Readonly<Record<ThreadNotificationCategory, ThreadNotificationCategoryPreferences>>

export const storedNotificationSoundsMuted = createEffectStoredValue({
  key: 'dshfiles.thread-sidebar.notification-sounds-muted.v1',
  schema: Schema.Boolean,
  fallback: false,
})

export const storedNotificationsMuted = createEffectStoredValue({
  key: 'dshfiles.thread-sidebar.notifications-muted.v1',
  schema: Schema.Boolean,
  fallback: false,
})

export const DEFAULT_THREAD_NOTIFICATION_CATEGORIES = {
  'approval-needed': { delivery: 'off', sound: false, soundPreset: 'soft', volume: 0.5 },
  'input-needed': { delivery: 'off', sound: false, soundPreset: 'chime', volume: 0.5 },
  'turn-finished': { delivery: 'off', sound: false, soundPreset: 'bright', volume: 0.5 },
  stopped: { delivery: 'off', sound: false, soundPreset: 'low', volume: 0.5 },
  failed: { delivery: 'off', sound: false, soundPreset: 'low', volume: 0.5 },
} satisfies ThreadNotificationCategories

const threadNotificationCategoryPreferencesSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    delivery: Schema.Literals(['off', 'in-app', 'system', 'both']),
    sound: Schema.Boolean,
    soundPreset: Schema.Literals(['soft', 'chime', 'bright', 'low']),
    volume: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  }),
)

export const threadNotificationCategoriesSchema = SchemaHelpers.withDecodedDefault(
  SchemaHelpers.strictStruct(
    Schema.Struct({
      'approval-needed': SchemaHelpers.withDecodedDefault(
        threadNotificationCategoryPreferencesSchema,
        () => DEFAULT_THREAD_NOTIFICATION_CATEGORIES['approval-needed'],
      ),
      'input-needed': SchemaHelpers.withDecodedDefault(
        threadNotificationCategoryPreferencesSchema,
        () => DEFAULT_THREAD_NOTIFICATION_CATEGORIES['input-needed'],
      ),
      'turn-finished': SchemaHelpers.withDecodedDefault(
        threadNotificationCategoryPreferencesSchema,
        () => DEFAULT_THREAD_NOTIFICATION_CATEGORIES['turn-finished'],
      ),
      stopped: SchemaHelpers.withDecodedDefault(threadNotificationCategoryPreferencesSchema, () => DEFAULT_THREAD_NOTIFICATION_CATEGORIES.stopped),
      failed: SchemaHelpers.withDecodedDefault(threadNotificationCategoryPreferencesSchema, () => DEFAULT_THREAD_NOTIFICATION_CATEGORIES.failed),
    }),
  ),
  () => DEFAULT_THREAD_NOTIFICATION_CATEGORIES,
)

const notificationRouteHasInApp = (delivery: ThreadNotificationDelivery): boolean => delivery === 'in-app' || delivery === 'both'
const notificationRouteHasSystem = (delivery: ThreadNotificationDelivery): boolean => delivery === 'system' || delivery === 'both'
const threadNotificationHasOutput = (preference: ThreadNotificationCategoryPreferences): boolean => preference.delivery !== 'off' || preference.sound

const notificationCategoriesAreDefault = (categories: ThreadNotificationCategories): boolean =>
  THREAD_NOTIFICATION_CATEGORIES.every(category => {
    const current = categories[category]
    const fallback = DEFAULT_THREAD_NOTIFICATION_CATEGORIES[category]
    return (
      current.delivery === fallback.delivery &&
      current.sound === fallback.sound &&
      current.soundPreset === fallback.soundPreset &&
      current.volume === fallback.volume
    )
  })

const categoriesForLegacyDesktopNotifications = () =>
  ({
    'approval-needed': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['approval-needed'], delivery: 'system' },
    'input-needed': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['input-needed'], delivery: 'system' },
    'turn-finished': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['turn-finished'], delivery: 'system' },
    stopped: { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES.stopped, delivery: 'system' },
    failed: { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES.failed, delivery: 'system' },
  }) satisfies ThreadNotificationCategories

/**
 * Every finish reason a thread can be notified about. A new reason in
 * {@link AttentionFinishReason} fails this map instead of silently going unannounced.
 */
const finishReasonCategories = {
  completed: 'turn-finished',
  error: 'failed',
  aborted: 'stopped',
  blocked: 'stopped',
  'max-tokens': 'stopped',
} as const satisfies Record<AttentionFinishReason, ThreadFinishNotificationCategory>

const categoryForFinishReason = (reason: AttentionFinishReason): ThreadFinishNotificationCategory => finishReasonCategories[reason]

const deliveredNotificationIdsSchema = Schema.mutable(Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)))).check(
  Schema.isMaxLength(5000),
)
const deliveredNotificationIds = createEffectStoredValue({
  key: 'dshfiles.thread-sidebar.notification-deliveries.v1',
  schema: deliveredNotificationIdsSchema,
  fallback: Schema.decodeUnknownSync(deliveredNotificationIdsSchema)([]),
})

const claimNotificationEvent = (knownIds: readonly string[], eventId: string) => {
  if (knownIds.includes(eventId)) return { claimed: false, notificationIds: knownIds }
  return { claimed: true, notificationIds: [...knownIds, eventId].slice(-5000) }
}

/** Claim a bounded per-browser event id before delivery, so mounted tabs do not repeat it. */
export const createThreadNotificationClaimer =
  (ledger: { readonly get: () => string[]; readonly set: (next: string[]) => boolean }): ((eventId: string) => boolean) =>
  (eventId: string): boolean => {
    const claim = claimNotificationEvent(ledger.get(), eventId)
    if (!claim.claimed) return false
    // A failed persistence write still leaves this tab's in-memory claim in place; deliver the event anyway.
    ledger.set([...claim.notificationIds])
    return true
  }

const claimThreadNotification = createThreadNotificationClaimer(deliveredNotificationIds)

export interface ThreadInteractionStatus {
  readonly pendingInteractionKey: string | undefined
  readonly pendingInteractionKind: string | undefined
}

export interface ThreadInteractionSnapshot<SessionIdentifier extends string = string> {
  readonly sessionId: SessionIdentifier
  readonly status: ThreadInteractionStatus
}

export interface ThreadInteractionTransitions<SessionIdentifier extends string = string> {
  readonly approvalNeeded: SessionIdentifier[]
  readonly inputNeeded: SessionIdentifier[]
}

/** Approvals and questions come from the Host's pending interactions, not from stored attention. */
const threadInteractionTransitions = <SessionIdentifier extends string>(
  previous: Readonly<Record<string, ThreadInteractionStatus>> | null,
  current: readonly ThreadInteractionSnapshot<SessionIdentifier>[],
): ThreadInteractionTransitions<SessionIdentifier> => {
  if (previous === null) return { approvalNeeded: [], inputNeeded: [] }
  const newInteractions = current.flatMap(({ sessionId, status }) =>
    status.pendingInteractionKey !== undefined && previous[sessionId]?.pendingInteractionKey !== status.pendingInteractionKey
      ? [{ sessionId, kind: status.pendingInteractionKind }]
      : [],
  )
  return {
    approvalNeeded: newInteractions.flatMap(({ sessionId, kind }) => (kind === 'approval' || kind === 'plan-review' ? [sessionId] : [])),
    inputNeeded: newInteractions.flatMap(({ sessionId, kind }) => (kind === 'question' ? [sessionId] : [])),
  }
}

const legacyTimestampMap = Schema.Record(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
)
const legacyMuteMap = Schema.Record(
  Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
)

/**
 * The blob this plugin used to keep in browser storage while attention was
 * browser-local. Read once to hand its records to the Host, then dropped.
 */
const legacyNotificationPreferencesSchema = Schema.Struct({
  enabled: SchemaHelpers.withDecodedDefault(Schema.Boolean, () => false),
  needsYouAt: SchemaHelpers.withDecodedDefault(legacyTimestampMap, () => ({})),
  mutedUntil: SchemaHelpers.withDecodedDefault(legacyMuteMap, () => ({})),
  manuallyUnreadSessionIds: SchemaHelpers.withDecodedDefault(
    Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).check(Schema.isMaxLength(5000)),
    () => [],
  ),
  seenCompletionSessionIds: SchemaHelpers.withDecodedDefault(
    Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).check(Schema.isMaxLength(5000)),
    () => [],
  ),
})

export type LegacyNotificationPreferences = Schema.Schema.Type<typeof legacyNotificationPreferencesSchema>

const LEGACY_NOTIFICATION_STORAGE_KEY = 'dshfiles.thread-sidebar.notifications.v1'

export const legacyNotificationPreferences = createEffectStoredValue({
  key: LEGACY_NOTIFICATION_STORAGE_KEY,
  schema: legacyNotificationPreferencesSchema,
  fallback: null,
})

/**
 * Acknowledged completions are not carried over: the Host records only finishes
 * it witnessed, so a stale "seen" id must not clear a completion the browser
 * has not shown yet.
 */
const legacyAttentionEntries = (legacy: LegacyNotificationPreferences): readonly ThreadAttentionMigrationEntry[] => {
  const entries = new Map<string, ThreadAttentionMigrationEntry>()
  for (const [sessionId, finishedAt] of Object.entries(legacy.needsYouAt)) entries.set(sessionId, { sessionId, finishedAt, manuallyUnread: false })
  for (const sessionId of legacy.manuallyUnreadSessionIds) {
    const existing = entries.get(sessionId)
    entries.set(sessionId, { sessionId, finishedAt: existing?.finishedAt ?? null, manuallyUnread: true })
  }
  return [...entries.values()]
}

export class ThreadNotificationModel {
  static readonly notificationRouteHasInApp = notificationRouteHasInApp
  static readonly notificationRouteHasSystem = notificationRouteHasSystem
  static readonly threadNotificationHasOutput = threadNotificationHasOutput
  static readonly notificationCategoriesAreDefault = notificationCategoriesAreDefault
  static readonly categoriesForLegacyDesktopNotifications = categoriesForLegacyDesktopNotifications
  static readonly categoryForFinishReason = categoryForFinishReason
  static readonly claimNotificationEvent = claimNotificationEvent
  static readonly claimThreadNotification = claimThreadNotification
  static readonly threadInteractionTransitions = threadInteractionTransitions
  static readonly legacyAttentionEntries = legacyAttentionEntries
}
