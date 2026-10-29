import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

const sessionIdSchema = z.string().min(1).max(256)

export const sessionUndoApi = defineApi({
  id: 'session-undo',
  version: 1,
  owner: '@dshfiles/session-undo',
  methods: {
    history: method({
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: z
        .object({
          checkpoints: z.array(z.object({ turn: z.number().int(), prompt: z.string(), at: z.number().int(), files: z.boolean() }).strict()),
          /** The thread a redo returns to; null when there is nothing to redo. */
          redoTo: sessionIdSchema.nullable(),
        })
        .strict(),
      description:
        'The turns of a thread that can be undone, newest last, each with its prompt and whether its files were snapshotted, and whether a redo is available. Read-only.',
      tool: {
        name: 'session_undo_history',
        readOnly: true,
        render: output =>
          [
            ...output.checkpoints.map(
              checkpoint => `turn ${String(checkpoint.turn)}${checkpoint.files ? ' (files)' : ''} · ${checkpoint.prompt || '(no text)'}`,
            ),
            output.redoTo === null ? 'Nothing to redo.' : `Redo returns to ${output.redoTo}.`,
          ].join('\n'),
      },
    }),
    undo: method({
      input: z.object({ sessionId: sessionIdSchema, confirm: z.literal(true) }).strict(),
      output: z.object({ sessionId: sessionIdSchema, filesRestored: z.boolean(), prompt: z.string() }).strict(),
      description:
        'Undo a thread’s last turn: put its workspace files back to the snapshot taken when the turn started, continue in a fork of the conversation cut before that turn, and archive the original until a redo. Refused while the thread runs. Requires confirm: true; call only when the user asked to undo that thread.',
      tool: {
        name: 'session_undo',
        render: output =>
          `Undid the turn “${output.prompt || '(no text)'}”${output.filesRestored ? ' and restored its files' : ' (no file snapshot)'}; the thread continues as ${output.sessionId}.`,
      },
    }),
    redo: method({
      input: z.object({ sessionId: sessionIdSchema }).strict(),
      output: z.object({ sessionId: sessionIdSchema, filesRestored: z.boolean() }).strict(),
      description:
        'Reverse the undo that created this thread: put the files back as they were before it, bring the original thread back and archive this one. Refused once this thread ran a new turn. Call only when the user asked to redo.',
      tool: {
        name: 'session_redo',
        render: output => `Redid the turn; the thread continues as ${output.sessionId}${output.filesRestored ? ' with its files restored' : ''}.`,
      },
    }),
  },
})
