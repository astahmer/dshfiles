import { Effect, Schema } from 'effect'
import { defineApi, method } from '@dshfiles/dshx/api'

const sha256Schema = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))
const savedOutputSchema = Schema.Struct({
  status: Schema.Literal('saved'),
  absolutePath: Schema.String,
  sha256: sha256Schema,
  bytes: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
const conflictOutputSchema = Schema.Struct({
  status: Schema.Literal('conflict'),
  currentSha256: Schema.NullOr(sha256Schema),
})

export const MAX_SAVE_BYTES = 8 * 1024 * 1024

export const editorWriteInputSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)).pipe(Schema.optional),
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  text: Schema.String.check(Schema.isMaxLength(MAX_SAVE_BYTES)),
  /** sha256 of the bytes the editor loaded; null creates a file that must not exist yet. */
  expectedSha256: Schema.NullOr(sha256Schema),
  /** Overwrite even when the file changed on disk since it was loaded. */
  overwrite: Schema.Boolean.pipe(Schema.optional, Schema.withDecodingDefault(Effect.succeed(false))),
})

export const editorApi = defineApi({
  id: 'editor',
  version: 1,
  methods: {
    write: method({
      input: editorWriteInputSchema,
      output: Schema.Union([savedOutputSchema, conflictOutputSchema]),
      description:
        'Save text to a file in a thread workspace through the editor guard. Pass the sha256 the file had when it was read, or null to create a file that must not exist yet; a file that changed on disk is refused with a conflict instead of being overwritten. Defaults to the calling thread. The guard makes this safer than a raw write, so no user request is needed beyond the task itself; pass overwrite: true only when the user asked to discard concurrent changes.',
      tool: {
        name: 'editor_write',
        render: output =>
          output.status === 'saved'
            ? `Saved ${output.absolutePath} (${String(output.bytes)} bytes, sha256 ${output.sha256}).`
            : `Refused: the file changed on disk since it was read (current ${output.currentSha256 ?? 'missing'}). Read it again, or pass overwrite: true if the user asked to discard those changes.`,
      },
    }),
  },
})
