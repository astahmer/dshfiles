/**
 * Quick replies the Inbox offers on a waiting thread's row (plan Q2 T2.5): one tap queues the text in that thread.
 * The Inbox owns the screen, so it declares the registry; a prompt library (`@dshfiles/prompt-stash`) provides the
 * replies. With no provider the row shows none.
 */
import { defineRegistry } from '@dshfiles/dshx/client'

export interface InboxQuickReply {
  readonly id: string
  /** Short chip text. */
  readonly label: string
  /** The message queued in the thread. */
  readonly text: string
}

export interface InboxQuickReplySource {
  readonly id: string
  /** At most a handful of replies, in the order the chips show them. */
  list(signal?: AbortSignal): Promise<readonly InboxQuickReply[]>
}

export const InboxQuickReplies = defineRegistry<InboxQuickReplySource>('@dshfiles/activity-timeline.quick-replies')
