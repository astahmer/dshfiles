import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

/** Reasons a finished turn counts as attention worth surfacing. */
export const ATTENTION_FINISH_REASONS = ['completed', 'aborted', 'blocked', 'error', 'max-tokens'] as const

export type AttentionFinishReason = (typeof ATTENTION_FINISH_REASONS)[number]

export const MAX_ATTENTION_SESSIONS = 2000

const sessionIdSchema = z.string().min(1).max(128)
const timestampSchema = z.number().int().nonnegative()

/**
 * One session with unacknowledged attention. Presence in a snapshot *is* the
 * unread signal, so acknowledging removes the record instead of keeping a
 * comparison row.
 */
export const threadAttentionViewSchema = z
  .object({
    sessionId: sessionIdSchema,
    /** Record version; a stale acknowledge never clears a finish recorded after it. */
    version: z.number().int().positive(),
    /** When the newest finished turn ended; null for a thread only marked unread by hand. */
    finishedAt: timestampSchema.nullable(),
    finishedSeq: z.number().int().nonnegative().nullable(),
    finishedReason: z.enum(ATTENTION_FINISH_REASONS).nullable(),
    manuallyUnread: z.boolean(),
  })
  .strict()

export const threadAttentionSnapshotSchema = z
  .object({
    /** Monotone across Host restarts so a stale read never replaces a newer write. */
    revision: z.number().int().positive(),
    sessions: z.array(threadAttentionViewSchema).max(MAX_ATTENTION_SESSIONS),
  })
  .strict()

/** Browser state carried over once, when this plugin starts owning the record on the Host. */
export const threadAttentionMigrationEntrySchema = z
  .object({
    sessionId: sessionIdSchema,
    finishedAt: timestampSchema.nullable(),
    manuallyUnread: z.boolean(),
  })
  .strict()

export const threadSidebarAttentionApi = defineApi({
  id: 'thread-sidebar-attention',
  version: 1,
  // Other plugins import this contract; without an owner each would derive its own channel.
  owner: '@dshfiles/thread-sidebar',
  methods: {
    state: method({
      input: z.void(),
      output: threadAttentionSnapshotSchema,
      description: 'Threads whose finished turn (or manual unread mark) the user has not acknowledged yet. Read-only.',
      tool: { name: 'thread_attention_state', readOnly: true },
    }),
    acknowledge: method({
      input: z.object({ sessionId: sessionIdSchema, version: z.number().int().positive() }).strict(),
      output: threadAttentionSnapshotSchema,
      description: 'Acknowledge the finished turn of one thread up to the record version the caller saw. A manual unread mark on the same thread survives.',
    }),
    clearUnread: method({
      input: z.object({ sessionId: sessionIdSchema, version: z.number().int().positive() }).strict(),
      output: threadAttentionSnapshotSchema,
      description: 'Drop every attention record for one thread, as when the user opens it.',
    }),
    clearUnreadMany: method({
      input: z
        .object({ entries: z.array(z.object({ sessionId: sessionIdSchema, version: z.number().int().positive() }).strict()).max(MAX_ATTENTION_SESSIONS) })
        .strict(),
      output: threadAttentionSnapshotSchema,
      description: 'Drop the attention records for many threads in one request, without clearing records newer than the caller saw.',
    }),
    markUnread: method({
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: threadAttentionSnapshotSchema,
      description: 'Mark one thread unread by hand; the mark persists until the thread is opened or acknowledged.',
    }),
    markUnreadMany: method({
      input: z.object({ sessionIds: z.array(sessionIdSchema).max(MAX_ATTENTION_SESSIONS) }).strict(),
      output: threadAttentionSnapshotSchema,
      description: 'Mark many threads unread by hand in one request; existing finish records are preserved.',
    }),
    migrate: method({
      input: z.object({ entries: z.array(threadAttentionMigrationEntrySchema).max(MAX_ATTENTION_SESSIONS) }).strict(),
      output: threadAttentionSnapshotSchema,
      description: 'Adopt browser-held attention records once, after this Host took ownership of them.',
    }),
  },
})

export type ThreadAttentionView = z.infer<typeof threadAttentionViewSchema>
export type ThreadAttentionSnapshot = z.infer<typeof threadAttentionSnapshotSchema>
export type ThreadAttentionMigrationEntry = z.infer<typeof threadAttentionMigrationEntrySchema>
