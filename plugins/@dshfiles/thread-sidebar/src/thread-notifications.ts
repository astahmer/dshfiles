import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

export interface ThreadNotificationPreferences {
  readonly enabled: boolean
  readonly needsYouAt: Readonly<Record<string, number>>
  /** Browser-only mutes from before they moved to Host settings; read once to migrate, then emptied. */
  readonly mutedUntil: Readonly<Record<string, number | null>>
  readonly manuallyUnreadSessionIds: string[]
}

export const DEFAULT_THREAD_NOTIFICATION_PREFERENCES: ThreadNotificationPreferences = {
  enabled: false,
  needsYouAt: {},
  mutedUntil: {},
  manuallyUnreadSessionIds: [],
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

export const isThreadUnread = (preferences: ThreadNotificationPreferences, sessionId: string): boolean =>
  preferences.manuallyUnreadSessionIds.includes(sessionId)

export const markThreadUnread = (preferences: ThreadNotificationPreferences, sessionId: string): ThreadNotificationPreferences => ({
  ...preferences,
  manuallyUnreadSessionIds: [...new Set([...preferences.manuallyUnreadSessionIds, sessionId])],
})

export const markThreadSeen = (preferences: ThreadNotificationPreferences, sessionId: string): ThreadNotificationPreferences => {
  const needsYouAt = { ...preferences.needsYouAt }
  delete needsYouAt[sessionId]
  return {
    ...preferences,
    needsYouAt,
    manuallyUnreadSessionIds: preferences.manuallyUnreadSessionIds.filter(id => id !== sessionId),
  }
}
