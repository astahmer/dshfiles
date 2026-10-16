import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import type { ThreadAttentionMigrationEntry } from './attention-api.js'

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
