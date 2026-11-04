import { defineApi, method } from '@dshfiles/dshx/api'
import { Schema } from 'effect'

const idSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
const pathSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096))
const intSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const modelSchema = Schema.Struct({ provider: Schema.String, model: Schema.String, reasoningEffort: Schema.optional(Schema.String) })
const summarySchema = Schema.Struct({
  title: Schema.NullOr(Schema.String),
  exportedAt: Schema.Number,
  createdAt: Schema.Number,
  eventCount: intSchema,
  messageCount: intSchema,
  attachmentCount: intSchema,
  attachmentBytes: intSchema,
  missingAttachments: intSchema,
  model: Schema.NullOr(modelSchema),
  folderName: Schema.NullOr(Schema.String),
  sessionFormat: Schema.Number,
})
type Summary = typeof summarySchema.Type

const sourceSchema = Schema.Union([Schema.Struct({ transferId: idSchema }), Schema.Struct({ path: pathSchema })])

const mebibytes = (bytes: number): string => `${(bytes / 1024 / 1024).toFixed(bytes < 1024 * 1024 ? 2 : 1)} MiB`
const describe = (summary: Summary): string =>
  [
    `“${summary.title ?? 'Untitled thread'}”: ${String(summary.messageCount)} messages, ${String(summary.eventCount)} events`,
    `${String(summary.attachmentCount)} attachments (${mebibytes(summary.attachmentBytes)})${summary.missingAttachments > 0 ? `, ${String(summary.missingAttachments)} unreadable and left out` : ''}`,
    summary.model === null ? 'no model recorded' : `model ${summary.model.provider}/${summary.model.model}`,
  ].join('; ')

export const threadTransferApi = defineApi({
  id: 'thread-transfer',
  version: 1,
  owner: '@dshfiles/thread-transfer',
  methods: {
    exportStage: method({
      input: Schema.Struct({ sessionId: idSchema }),
      output: Schema.Struct({ transferId: idSchema, fileName: Schema.String, bytes: intSchema, summary: summarySchema }),
      description:
        'Build a portable .dshthread bundle of one thread (every message, tool call and result, attachment, title and model) and stage it for the browser to download with exportChunk. Read-only for the thread.',
    }),
    exportChunk: method({
      input: Schema.Struct({ transferId: idSchema, offset: intSchema }),
      output: Schema.Struct({ data: Schema.String, nextOffset: intSchema, done: Schema.Boolean }),
      description: 'Read the next base64 chunk of a staged export; the transfer is released after its last chunk.',
    }),
    exportFile: method({
      input: Schema.Struct({ sessionId: idSchema, path: pathSchema }),
      output: Schema.Struct({ path: Schema.String, fileName: Schema.String, bytes: intSchema, summary: summarySchema }),
      description:
        'Export one thread (messages, tool calls and results, attachments, title, model) to a portable .dshthread file at an absolute path on this machine that does not exist yet, so it can be imported as a new thread on another machine. It changes no thread. Call only when the user asked to export that thread.',
      tool: {
        name: 'thread_export',
        render: output => `Exported to ${output.path} (${mebibytes(output.bytes)}): ${describe(output.summary)}.`,
      },
    }),
    importStage: method({
      input: Schema.Struct({ bytes: intSchema }),
      output: Schema.Struct({ transferId: idSchema, chunkBytes: intSchema }),
      description: 'Announce a .dshthread upload of this many bytes; send it with importChunk, then preview it with inspect and commit it with import.',
    }),
    importChunk: method({
      input: Schema.Struct({ transferId: idSchema, offset: intSchema, data: Schema.String }),
      output: Schema.Struct({ received: intSchema }),
      description: 'Append the next base64 chunk of a staged upload at its offset.',
    }),
    inspect: method({
      input: Schema.Struct({ source: sourceSchema }),
      output: Schema.Struct({ summary: summarySchema, problem: Schema.NullOr(Schema.String) }),
      description:
        'Preview a .dshthread bundle — an uploaded transfer or an absolute file path on this machine — without importing it: its title, message, event and attachment counts, model, and why this machine cannot import it, if it cannot. Read-only.',
      tool: {
        name: 'thread_bundle_inspect',
        readOnly: true,
        render: output =>
          `${describe(output.summary)}.${output.problem === null ? ' It can be imported here.' : ` It cannot be imported here: ${output.problem}`}`,
      },
    }),
    import: method({
      input: Schema.Struct({ source: sourceSchema, workspaceId: Schema.optional(idSchema), cwd: Schema.optional(pathSchema) }),
      output: Schema.Struct({
        sessionId: idSchema,
        title: Schema.NullOr(Schema.String),
        cwd: Schema.String,
        workspaceId: Schema.NullOr(Schema.String),
        events: intSchema,
        attachments: intSchema,
      }),
      description:
        'Import a .dshthread bundle (an uploaded transfer, or an absolute file path on this machine) as a new thread with a fresh id: its attachments are saved into this machine’s store and it runs in the registered project `workspaceId`, or the existing folder `cwd`, or the home folder. The source thread and other threads are unchanged; archive the new thread to undo it. Call only when the user asked to import that bundle.',
      tool: {
        name: 'thread_import',
        render: output =>
          `Imported “${output.title ?? 'Untitled thread'}” as ${output.sessionId} in ${output.cwd}${output.workspaceId === null ? ' (no project)' : ''}: ${String(output.events)} events, ${String(output.attachments)} attachments.`,
      },
    }),
    destinations: method({
      input: Schema.Struct({}),
      output: Schema.Struct({
        home: Schema.String,
        projects: Schema.Array(Schema.Struct({ workspaceId: Schema.String, title: Schema.String, path: Schema.String })),
      }),
      description: 'Where an imported thread can run: the registered projects (workspace id, title, folder) and the home folder. Read-only.',
      tool: {
        name: 'thread_import_destinations',
        readOnly: true,
        render: output => [`home: ${output.home}`, ...output.projects.map(project => `${project.workspaceId} · ${project.title} · ${project.path}`)].join('\n'),
      },
    }),
  },
})
