import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

const instructionFileSchema = Schema.Struct({
  /** The path the model sees (project-relative, or `~/…` for a user-global file). */
  path: Schema.String,
  absolutePath: Schema.String,
  /** File size in bytes, or null when it could not be read. */
  bytes: Schema.NullOr(Schema.Number),
})

export type InstructionFile = typeof instructionFileSchema.Type

const describeSize = (bytes: number | null): string => (bytes === null ? 'unreadable' : `${(bytes / 1024).toFixed(1)} KB`)

export const agentToolkitApi = defineApi({
  id: 'agent-toolkit',
  version: 1,
  owner: '@dshfiles/agent-toolkit',
  methods: {
    versions: method({
      input: Schema.Struct({
        packages: Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(240))).check(Schema.isMaxLength(500)),
      }),
      output: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
      description: 'The installed version of each package as the current DSH profile resolves it; null when it cannot be found.',
    }),
    instructionFiles: method({
      input: Schema.Struct({
        cwd: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096)).annotate({ description: 'Absolute folder a thread works in.' }),
      }),
      output: Schema.Struct({ files: Schema.Array(instructionFileSchema) }),
      description:
        "The AGENTS.md-compatible instruction files DSH's workspace instruction loader finds for a thread folder with its default discovery settings (user-global first, then project root to folder), with their sizes. Read-only.",
      tool: {
        name: 'context_instruction_files',
        readOnly: true,
        render: output =>
          output.files.length === 0
            ? 'No workspace instruction files for that folder.'
            : output.files.map(file => `${file.path} · ${describeSize(file.bytes)}`).join('\n'),
      },
    }),
  },
})
