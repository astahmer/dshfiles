import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'

export interface ThreadNotificationPreferences {
  readonly enabled: boolean
  readonly needsYouAt: Readonly<Record<string, number>>
  readonly mutedUntil: Readonly<Record<string, number | null>>
}

export const DEFAULT_THREAD_NOTIFICATION_PREFERENCES: ThreadNotificationPreferences = {
  enabled: false,
  needsYouAt: {},
  mutedUntil: {},
}

const timestampMap = z.record(z.string().min(1).max(256), z.number().int().nonnegative()).refine(value => Object.keys(value).length <= 5000)
const muteMap = z.record(z.string().min(1).max(256), z.number().int().nonnegative().nullable()).refine(value => Object.keys(value).length <= 5000)

export const threadNotificationPreferences = createStoredValue({
  key: 'dshfiles.thread-sidebar.notifications.v1',
  schema: z.object({ enabled: z.boolean(), needsYouAt: timestampMap, mutedUntil: muteMap }).strict(),
  fallback: DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
})

export const snoozeDurations = [
  { label: 'threadSidebarSnooze15Minutes', milliseconds: 15 * 60_000 },
  { label: 'threadSidebarSnooze1Hour', milliseconds: 60 * 60_000 },
  { label: 'threadSidebarSnooze3Hours', milliseconds: 3 * 60 * 60_000 },
  { label: 'threadSidebarSnooze8Hours', milliseconds: 8 * 60 * 60_000 },
  { label: 'threadSidebarSnooze24Hours', milliseconds: 24 * 60 * 60_000 },
] as const

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

export const isThreadMuted = (preferences: ThreadNotificationPreferences, sessionId: string, now: number): boolean => {
  const mutedUntil = preferences.mutedUntil[sessionId]
  return mutedUntil === null || (mutedUntil !== undefined && mutedUntil > now)
}

export const setThreadMute = (preferences: ThreadNotificationPreferences, sessionId: string, mutedUntil: number | null): ThreadNotificationPreferences => ({
  ...preferences,
  mutedUntil: { ...preferences.mutedUntil, [sessionId]: mutedUntil },
})

export const clearThreadMute = (preferences: ThreadNotificationPreferences, sessionId: string): ThreadNotificationPreferences => {
  const mutedUntil = { ...preferences.mutedUntil }
  delete mutedUntil[sessionId]
  return { ...preferences, mutedUntil }
}

export const markThreadSeen = (preferences: ThreadNotificationPreferences, sessionId: string): ThreadNotificationPreferences => {
  const needsYouAt = { ...preferences.needsYouAt }
  delete needsYouAt[sessionId]
  return { ...preferences, needsYouAt }
}

export const clearExpiredThreadMutes = (preferences: ThreadNotificationPreferences, now: number): ThreadNotificationPreferences => ({
  ...preferences,
  mutedUntil: Object.fromEntries(Object.entries(preferences.mutedUntil).filter(([, until]) => until === null || until > now)),
})
