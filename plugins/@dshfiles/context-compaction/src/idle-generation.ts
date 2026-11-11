import type { SessionEvent } from '@deepseek-ai/dsh-session'

/**
 * The idle start a session event arms, or null when it does not start one. A compaction's own checkpoint message is
 * written as `user/message`, so ignoring only its source kind keeps the sweep from arming itself after a compaction.
 */
export const idleGenerationStart = (event: SessionEvent): number | null => {
  if (event.type === 'user/message') return event.data.source.kind === 'compact-checkpoint' ? null : event.time
  return event.type === 'request/header' || event.type === 'turn/end' ? event.time : null
}
