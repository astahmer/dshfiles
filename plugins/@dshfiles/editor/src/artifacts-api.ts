import { Schema } from 'effect'
import { defineApi, method } from '@dshfiles/dshx/api'

const sessionId = Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)))
const id = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))
const title = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512))
const mimeType = Schema.Literals(['text/markdown', 'text/html'])
const content = Schema.String.check(
  Schema.makeFilter(value => new TextEncoder().encode(JSON.stringify(value)).byteLength <= 240 * 1024 || 'Content exceeds 240 KiB encoded.'),
)
const revision = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1))
const metadataFields = { id, title, mimeType, revision, createdAt: Schema.String, updatedAt: Schema.String }
export const artifactSchema = Schema.Struct({ ...metadataFields, content })
const metadata = Schema.Struct(metadataFields)
const conflict = Schema.Struct({ status: Schema.Literal('conflict'), currentRevision: revision })
const result = Schema.Struct({ artifact: artifactSchema })

export const artifactCreateInputSchema = Schema.Struct({ sessionId, title, mimeType, content })
export const artifactDeleteInputSchema = Schema.Struct({ sessionId, id, expectedRevision: revision, confirm: Schema.Literal(true) })
export const artifactUpdateInputSchema = Schema.Struct({
  sessionId,
  id,
  expectedRevision: revision,
  title: Schema.optional(title),
  mimeType: Schema.optional(mimeType),
  content: Schema.optional(content),
})

export const editorArtifactsApi = defineApi({
  id: 'editor-artifacts',
  version: 1,
  owner: '@dshfiles/editor',
  methods: {
    list: method({
      input: Schema.Struct({ sessionId }),
      output: Schema.Struct({ artifacts: Schema.Array(metadata) }),
      description: 'List artifacts in a thread. Defaults to the calling thread.',
      tool: { name: 'artifact_list', readOnly: true },
    }),
    read: method({
      input: Schema.Struct({ sessionId, id }),
      output: result,
      description: 'Read an artifact in a thread. Defaults to the calling thread.',
      tool: { name: 'artifact_read', readOnly: true },
    }),
    create: method({
      input: artifactCreateInputSchema,
      output: result,
      description: 'Create an artifact only when the user asked. Defaults to the calling thread.',
      tool: { name: 'artifact_create' },
    }),
    update: method({
      input: artifactUpdateInputSchema,
      output: Schema.Union([result, conflict]),
      description: 'Update an artifact only when the user asked. Refuses stale revisions.',
      tool: { name: 'artifact_update' },
    }),
    delete: method({
      input: artifactDeleteInputSchema,
      output: Schema.Union([Schema.Struct({ deleted: Schema.Literal(true) }), conflict]),
      description: 'Delete an artifact only when the user asked; confirm must be true. Refuses stale revisions.',
      tool: { name: 'artifact_delete' },
    }),
  },
})
