import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import type { AttentionFinishReason, ThreadAttentionMigrationEntry } from './attention-api.js'

export const THREAD_NOTIFICATION_CATEGORIES = ['approval-needed', 'input-needed', 'turn-finished', 'failed'] as const
export type ThreadNotificationCategory = (typeof THREAD_NOTIFICATION_CATEGORIES)[number]
export type ThreadNotificationDelivery = 'off' | 'in-app' | 'system' | 'both'
export type ThreadNotificationSound = 'soft' | 'chime' | 'bright' | 'low'

export interface ThreadNotificationCategoryPreferences {
  readonly delivery: ThreadNotificationDelivery
  readonly sound: boolean
  readonly soundPreset: ThreadNotificationSound
  readonly volume: number
}

export type ThreadNotificationCategories = Readonly<Record<ThreadNotificationCategory, ThreadNotificationCategoryPreferences>>

export const DEFAULT_THREAD_NOTIFICATION_CATEGORIES = {
  'approval-needed': { delivery: 'off', sound: false, soundPreset: 'soft', volume: 0.5 },
  'input-needed': { delivery: 'off', sound: false, soundPreset: 'chime', volume: 0.5 },
  'turn-finished': { delivery: 'off', sound: false, soundPreset: 'bright', volume: 0.5 },
  failed: { delivery: 'off', sound: false, soundPreset: 'low', volume: 0.5 },
} satisfies ThreadNotificationCategories

export const threadNotificationCategoryPreferencesSchema = z
  .object({
    delivery: z.enum(['off', 'in-app', 'system', 'both']),
    sound: z.boolean(),
    soundPreset: z.enum(['soft', 'chime', 'bright', 'low']),
    volume: z.number().min(0).max(1),
  })
  .strict()

export const threadNotificationCategoriesSchema = z
  .object({
    'approval-needed': threadNotificationCategoryPreferencesSchema.default(DEFAULT_THREAD_NOTIFICATION_CATEGORIES['approval-needed']),
    'input-needed': threadNotificationCategoryPreferencesSchema.default(DEFAULT_THREAD_NOTIFICATION_CATEGORIES['input-needed']),
    'turn-finished': threadNotificationCategoryPreferencesSchema.default(DEFAULT_THREAD_NOTIFICATION_CATEGORIES['turn-finished']),
    failed: threadNotificationCategoryPreferencesSchema.default(DEFAULT_THREAD_NOTIFICATION_CATEGORIES.failed),
  })
  .strict()
  .default(DEFAULT_THREAD_NOTIFICATION_CATEGORIES)

export const notificationRouteHasInApp = (delivery: ThreadNotificationDelivery): boolean => delivery === 'in-app' || delivery === 'both'
export const notificationRouteHasSystem = (delivery: ThreadNotificationDelivery): boolean => delivery === 'system' || delivery === 'both'
export const threadNotificationHasOutput = (preference: ThreadNotificationCategoryPreferences): boolean => preference.delivery !== 'off' || preference.sound

export const notificationCategoriesAreDefault = (categories: ThreadNotificationCategories): boolean =>
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

export const categoriesForLegacyDesktopNotifications = () =>
  ({
    'approval-needed': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['approval-needed'], delivery: 'system' },
    'input-needed': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['input-needed'], delivery: 'system' },
    'turn-finished': { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES['turn-finished'], delivery: 'system' },
    failed: { ...DEFAULT_THREAD_NOTIFICATION_CATEGORIES.failed, delivery: 'system' },
  }) satisfies ThreadNotificationCategories

export const categoryForFinishReason = (reason: AttentionFinishReason): ThreadNotificationCategory | undefined =>
  reason === 'error' ? 'failed' : reason === 'completed' ? 'turn-finished' : undefined

const deliveredNotificationIdsSchema = z.array(z.string().min(1).max(1024)).max(5000)
const deliveredNotificationIds = createStoredValue({
  key: 'dshfiles.thread-sidebar.notification-deliveries.v1',
  schema: deliveredNotificationIdsSchema,
  fallback: deliveredNotificationIdsSchema.parse([]),
})

export const claimNotificationEvent = (knownIds: readonly string[], eventId: string) => {
  if (knownIds.includes(eventId)) return { claimed: false, notificationIds: knownIds }
  return { claimed: true, notificationIds: [...knownIds, eventId].slice(-5000) }
}

/** Claim a bounded per-browser event id before delivery, so mounted tabs do not repeat it. */
export const claimThreadNotification = (eventId: string): boolean => {
  const claim = claimNotificationEvent(deliveredNotificationIds.get() ?? [], eventId)
  if (!claim.claimed) return false
  return deliveredNotificationIds.set([...claim.notificationIds])
}

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
export const threadInteractionTransitions = <SessionIdentifier extends string>(
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

const legacyTimestampMap = z.record(z.string().min(1).max(256), z.number().int().nonnegative())
const legacyMuteMap = z.record(z.string().min(1).max(256), z.number().int().nonnegative().nullable())

/**
 * The blob this plugin used to keep in browser storage while attention was
 * browser-local. Read once to hand its records to the Host, then dropped.
 */
const legacyNotificationPreferencesSchema = z.object({
  enabled: z.boolean().default(false),
  needsYouAt: legacyTimestampMap.default({}),
  mutedUntil: legacyMuteMap.default({}),
  manuallyUnreadSessionIds: z.array(z.string().min(1).max(256)).max(5000).default([]),
  seenCompletionSessionIds: z.array(z.string().min(1).max(256)).max(5000).default([]),
})

export type LegacyNotificationPreferences = z.infer<typeof legacyNotificationPreferencesSchema>

export const LEGACY_NOTIFICATION_STORAGE_KEY = 'dshfiles.thread-sidebar.notifications.v1'

export const legacyNotificationPreferences = createStoredValue({
  key: LEGACY_NOTIFICATION_STORAGE_KEY,
  schema: legacyNotificationPreferencesSchema,
  fallback: null,
})

/**
 * Acknowledged completions are not carried over: the Host records only finishes
 * it witnessed, so a stale "seen" id must not clear a completion the browser
 * has not shown yet.
 */
export const legacyAttentionEntries = (legacy: LegacyNotificationPreferences): readonly ThreadAttentionMigrationEntry[] => {
  const entries = new Map<string, ThreadAttentionMigrationEntry>()
  for (const [sessionId, finishedAt] of Object.entries(legacy.needsYouAt)) entries.set(sessionId, { sessionId, finishedAt, manuallyUnread: false })
  for (const sessionId of legacy.manuallyUnreadSessionIds) {
    const existing = entries.get(sessionId)
    entries.set(sessionId, { sessionId, finishedAt: existing?.finishedAt ?? null, manuallyUnread: true })
  }
  return [...entries.values()]
}
