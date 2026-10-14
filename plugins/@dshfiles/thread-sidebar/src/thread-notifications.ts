import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

export interface ThreadNotificationPreferences {
  readonly enabled: boolean
  readonly needsYouAt: Readonly<Record<string, number>>
  /** Browser-only mutes from before they moved to Host settings; read once to migrate, then emptied. */
  readonly mutedUntil: Readonly<Record<string, number | null>>
  readonly manuallyUnreadSessionIds: string[]
  readonly seenCompletionSessionIds: string[]
}

export const DEFAULT_THREAD_NOTIFICATION_PREFERENCES: ThreadNotificationPreferences = {
  enabled: false,
  needsYouAt: {},
  mutedUntil: {},
  manuallyUnreadSessionIds: [],
  seenCompletionSessionIds: [],
}

const timestampMap = z.record(z.string().min(1).max(256), z.number().int().nonnegative()).refine(value => Object.keys(value).length <= 5000)
const muteMap = z.record(z.string().min(1).max(256), z.number().int().nonnegative().nullable()).refine(value => Object.keys(value).length <= 5000)

export const threadNotificationPreferences = createStoredValue({
  key: 'dshfiles.thread-sidebar.notifications.v1',
  schema: z
    .object({
      enabled: z.boolean(),
      needsYouAt: timestampMap,
      mutedUntil: muteMap.default({}),
      manuallyUnreadSessionIds: z.array(z.string().min(1).max(256)).max(5000).default([]),
      seenCompletionSessionIds: z.array(z.string().min(1).max(256)).max(5000).default([]),
    })
    .strict(),
  fallback: DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
})

export interface ThreadAttentionStatus {
  readonly pendingInteractionKey: string | undefined
  readonly pendingInteractionKind: string | undefined
  readonly completionUnread: boolean
}

export interface ThreadAttentionTransitions<SessionIdentifier extends string = string> {
  readonly approvalNeeded: SessionIdentifier[]
  readonly inputNeeded: SessionIdentifier[]
  readonly turnFinished: SessionIdentifier[]
}

export interface ThreadCompletionSnapshot<SessionIdentifier extends string = string> {
  readonly sessionId: SessionIdentifier
  readonly completionUnread: boolean | undefined
}

export interface ThreadCompletionReconciliation {
  readonly preferences: ThreadNotificationPreferences
  readonly changed: boolean
}

export const threadAttentionTransitions = <SessionIdentifier extends string>(
  previous: Readonly<Record<string, ThreadAttentionStatus>> | null,
  current: readonly { readonly sessionId: SessionIdentifier; readonly status: ThreadAttentionStatus }[],
): ThreadAttentionTransitions<SessionIdentifier> => {
  if (previous === null) return { approvalNeeded: [], inputNeeded: [], turnFinished: [] }
  const newInteractions = current.flatMap(({ sessionId, status }) =>
    status.pendingInteractionKey !== undefined && previous[sessionId]?.pendingInteractionKey !== status.pendingInteractionKey
      ? [{ sessionId, kind: status.pendingInteractionKind }]
      : [],
  )
  const approvalNeeded = newInteractions.flatMap(({ sessionId, kind }) => (kind === 'approval' || kind === 'plan-review' ? [sessionId] : []))
  const inputNeeded = newInteractions.flatMap(({ sessionId, kind }) => (kind === 'question' ? [sessionId] : []))
  const turnFinished = current.flatMap(({ sessionId, status }) => {
    const classifiedInteraction =
      status.pendingInteractionKind === 'approval' || status.pendingInteractionKind === 'question' || status.pendingInteractionKind === 'plan-review'
    return status.completionUnread && !classifiedInteraction && previous[sessionId]?.completionUnread !== true ? [sessionId] : []
  })
  return { approvalNeeded, inputNeeded, turnFinished }
}

export const reconcileFinishedThreadNotifications = ({
  preferences,
  statuses,
  eligibleSessionIds,
  newlyFinishedSessionIds,
  now,
}: {
  readonly preferences: ThreadNotificationPreferences
  readonly statuses: readonly ThreadCompletionSnapshot[]
  readonly eligibleSessionIds: ReadonlySet<string>
  readonly newlyFinishedSessionIds: readonly string[]
  readonly now: number
}): ThreadCompletionReconciliation => {
  const needsYouAt = { ...preferences.needsYouAt }
  const seenCompletionSessionIds = new Set(preferences.seenCompletionSessionIds)
  let changed = false

  for (const sessionId of newlyFinishedSessionIds) {
    if (seenCompletionSessionIds.delete(sessionId)) changed = true
  }

  for (const { sessionId, completionUnread } of statuses) {
    if (completionUnread === false) {
      if (seenCompletionSessionIds.delete(sessionId)) changed = true
      if (needsYouAt[sessionId] !== undefined) {
        delete needsYouAt[sessionId]
        changed = true
      }
      continue
    }
    if (completionUnread !== true || !eligibleSessionIds.has(sessionId) || seenCompletionSessionIds.has(sessionId) || needsYouAt[sessionId] !== undefined) {
      continue
    }
    needsYouAt[sessionId] = now
    changed = true
  }

  return {
    changed,
    preferences: changed ? { ...preferences, needsYouAt, seenCompletionSessionIds: [...seenCompletionSessionIds] } : preferences,
  }
}

export const isThreadUnread = (preferences: ThreadNotificationPreferences, sessionId: string): boolean =>
  preferences.manuallyUnreadSessionIds.includes(sessionId)

export const markThreadUnread = (preferences: ThreadNotificationPreferences, sessionId: string): ThreadNotificationPreferences => ({
  ...preferences,
  manuallyUnreadSessionIds: [...new Set([...preferences.manuallyUnreadSessionIds, sessionId])],
})

export const markThreadSeen = (preferences: ThreadNotificationPreferences, sessionId: string, completionUnread = false): ThreadNotificationPreferences => {
  const needsYouAt = { ...preferences.needsYouAt }
  const wasCompletionUnread = completionUnread || needsYouAt[sessionId] !== undefined
  delete needsYouAt[sessionId]
  const seenCompletionSessionIds = wasCompletionUnread
    ? [...new Set([...preferences.seenCompletionSessionIds, sessionId])].slice(-5000)
    : preferences.seenCompletionSessionIds
  return {
    ...preferences,
    needsYouAt,
    manuallyUnreadSessionIds: preferences.manuallyUnreadSessionIds.filter(id => id !== sessionId),
    seenCompletionSessionIds,
  }
}
