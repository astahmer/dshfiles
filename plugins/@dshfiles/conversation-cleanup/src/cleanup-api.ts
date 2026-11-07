import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const candidateSchema = Schema.Struct({ sessionId: Schema.String, archived: Schema.Boolean, settled: Schema.Boolean })
export const previewSchema = Schema.Struct({
  previewId: Schema.String,
  candidates: Schema.Array(candidateSchema),
  protectedCount: Schema.Number,
  remainingCount: Schema.Number,
  expiresAt: Schema.Number,
})
export const receiptSchema = Schema.Struct({
  results: Schema.Array(Schema.Struct({ sessionId: Schema.String, status: Schema.Literals(['deleted', 'skipped', 'failed']), message: Schema.String })),
})

export const cleanupApi = defineApi({
  id: 'conversation-cleanup',
  owner: '@dshfiles/conversation-cleanup',
  version: 1,
  methods: {
    preview: method({
      input: Schema.Struct({}),
      output: previewSchema,
      description:
        'Preview permanent deletion of up to 200 local settled OR archived conversations. Loaded sessions, background activity, migration-required logs and the caller are protected. Nothing is deleted. Read-only; preview expires after ten minutes.',
      readOnly: true,
      tool: { name: 'conversation_cleanup_preview', readOnly: true },
    }),
    delete: method({
      input: Schema.Struct({ previewId: Schema.String, confirm: Schema.Literal(true) }),
      output: receiptSchema,
      description:
        'Permanently delete the exact conversations in a fresh cleanup preview, after rechecking their state and obtaining each persistence write lock. Irreversible: removes local JSONL generations, not shared attachments, workspaces, backups or derived indexes. Loaded or changed sessions are skipped; failures are reported individually. Agent calls require a root conversation with Full access; delegated or restricted agents are refused. Call only when the user explicitly asked to delete these conversations and confirmed permanent deletion.',
      tool: { name: 'conversation_cleanup_delete', readOnly: false },
    }),
  },
})
