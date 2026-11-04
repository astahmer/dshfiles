import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const intSchema = Schema.Number.check(Schema.isInt())

const rewindOutput = Schema.Struct({
  sessionId: sessionIdSchema,
  filesRestored: Schema.Boolean,
  prompt: Schema.String,
  /** The turn the thread was rewound to the start of. */
  turn: intSchema,
  /** Recorded turns dropped from the fork, the rewound one included. */
  turnsRewound: intSchema,
})

const renderRewind = (output: typeof rewindOutput.Type): string =>
  `${output.turnsRewound > 1 ? `Rewound ${String(output.turnsRewound)} turns, back to before turn ${String(output.turn)}` : 'Undid the turn'} “${output.prompt || '(no text)'}”${output.filesRestored ? ' and restored its files' : ' (no file snapshot)'}; the thread continues as ${output.sessionId}. session_redo reverses it.`

export const sessionUndoApi = defineApi({
  id: 'session-undo',
  version: 1,
  owner: '@dshfiles/session-undo',
  methods: {
    history: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: Schema.Struct({
        checkpoints: Schema.Array(Schema.Struct({ turn: intSchema, prompt: Schema.String, at: intSchema, files: Schema.Boolean })),
        /** The thread a redo returns to; null when there is nothing to redo. */
        redoTo: Schema.NullOr(sessionIdSchema),
      }),
      description:
        'The turns of a thread that can be undone or rewound to (session_rewind takes their turn number), newest last, each with its prompt and whether its files were snapshotted, and whether a redo is available. Read-only.',
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
      input: Schema.Struct({ sessionId: sessionIdSchema, confirm: Schema.Literal(true), allowSharedDirectory: Schema.optional(Schema.Literal(true)) }),
      output: rewindOutput,
      description:
        'Undo a thread’s last turn: put its workspace files back to the snapshot taken when the turn started, continue in a fork of the conversation cut before that turn, and archive the original until a redo. Refused while the thread runs, and refused when another live thread works in the same folder unless allowSharedDirectory: true (it would overwrite that thread’s edits). Requires confirm: true; call only when the user asked to undo that thread.',
      tool: { name: 'session_undo', render: output => renderRewind(output) },
    }),
    rewind: method({
      input: Schema.Struct({
        sessionId: sessionIdSchema,
        /** A turn number from session_undo_history. */
        turn: intSchema,
        confirm: Schema.Literal(true),
        allowSharedDirectory: Schema.optional(Schema.Literal(true)),
      }),
      output: rewindOutput,
      description:
        'Rewind a thread to just before an earlier turn (a turn number from session_undo_history): put the workspace files back to the snapshot taken when that turn started, continue in a fork of the conversation cut before it — that turn and every later one are dropped from the fork — and archive the original until a redo. Refused while the thread runs, and refused when another live thread works in the same folder unless allowSharedDirectory: true (it would overwrite that thread’s edits). Requires confirm: true; call only when the user asked to rewind that thread.',
      tool: { name: 'session_rewind', render: output => renderRewind(output) },
    }),
    redo: method({
      input: Schema.Struct({ sessionId: sessionIdSchema, allowSharedDirectory: Schema.optional(Schema.Literal(true)) }),
      output: Schema.Struct({ sessionId: sessionIdSchema, filesRestored: Schema.Boolean }),
      description:
        'Reverse the undo or rewind that created this thread: put the files back as they were before it, bring the original thread back with every rewound turn, and archive this one. Refused once this thread ran a new turn, and when another live thread works in the same folder unless allowSharedDirectory: true. Call only when the user asked to redo.',
      tool: {
        name: 'session_redo',
        render: output => `Redid the turn; the thread continues as ${output.sessionId}${output.filesRestored ? ' with its files restored' : ''}.`,
      },
    }),
  },
})
