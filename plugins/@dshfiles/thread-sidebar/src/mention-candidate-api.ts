import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1)).check(Schema.isMaxLength(512))

const threadMentionCandidateRequestSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  agentSessionId: Schema.optional(sessionIdSchema),
})

const threadMentionCandidateSchema = Schema.Struct({
  sessionId: Schema.String,
  label: Schema.String,
  displayTitle: Schema.String,
  mention: Schema.String,
})

const threadMentionCandidateAnswerSchema = Schema.Union([
  Schema.Struct({ candidate: threadMentionCandidateSchema }),
  Schema.Struct({ reason: Schema.Literals(['self', 'missing', 'unavailable']) }),
])

export type ThreadMentionCandidateRequest = Schema.Schema.Type<typeof threadMentionCandidateRequestSchema>
export type ThreadMentionCandidateAnswer = Schema.Schema.Type<typeof threadMentionCandidateAnswerSchema>

/** One-Session mention resolution for the thread menu actions; the native resolver remains the fallback. */
export const threadMentionCandidateApi = defineApi({
  id: 'thread-mention-candidate',
  version: 1,
  owner: '@dshfiles/thread-sidebar',
  methods: {
    resolve: method({
      input: threadMentionCandidateRequestSchema,
      output: threadMentionCandidateAnswerSchema,
      description:
        'Resolve one Session by id into the canonical mention a thread menu action inserts: its projection-backed label, subagent display label and `dsh-session:` URI. Reads that Session only, never the whole corpus. Read-only.',
    }),
  },
})
