import type { SessionEvent, SessionEventType } from '@deepseek-ai/dsh-session'

/** The fields of a Session event that decide whether it arms an idle stretch; every {@link SessionEvent} has them. */
export type IdleBoundaryEvent =
  | {
      readonly type: 'user/message'
      readonly time: number
      readonly data: { readonly source: { readonly kind: SessionEvent<'user/message'>['data']['source']['kind'] } }
    }
  | { readonly type: Exclude<SessionEventType, 'user/message'>; readonly time: number }

/**
 * The idle start a session event arms, or null when it does not start one. A compaction's own checkpoint message is
 * written as `user/message`, so ignoring only its source kind keeps the sweep from arming itself after a compaction.
 */
export const idleGenerationStart = (event: IdleBoundaryEvent): number | null => {
  if (event.type === 'user/message') return event.data.source.kind === 'compact-checkpoint' ? null : event.time
  return event.type === 'request/header' || event.type === 'turn/end' ? event.time : null
}
