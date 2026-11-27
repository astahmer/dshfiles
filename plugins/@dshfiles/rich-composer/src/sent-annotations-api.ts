/** Host-shared sent-annotation history: the review layer a session keeps after its messages are sent. */
import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'

/** Most recent annotations kept per session; older ones drop from the Host store first. */
export const SENT_ANNOTATION_LIMIT = 200

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))

const annotationTextSchema = Schema.String.check(Schema.isMaxLength(20_000))

const annotationCommentSchema = Schema.String.check(Schema.isMaxLength(5_000))

const annotationSourceSchema = Schema.String.check(Schema.isMaxLength(2_000))

/** One annotation a sent message carried, with the comment written on it. */
export const SentAnnotationSchema = Schema.Struct({
  /** Positive sequence per session, assigned by the Host. */
  id: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
  text: annotationTextSchema,
  comment: annotationCommentSchema,
  /** Opaque locator its surface recorded; empty when unknown. */
  source: annotationSourceSchema,
  /** When the message carrying it was accepted, in epoch milliseconds. */
  sentAt: Schema.Number.check(Schema.isFinite()),
})

export type SentAnnotation = typeof SentAnnotationSchema.Type

export const sentAnnotationsApi = defineApi({
  id: 'sent-annotations',
  version: 1,
  owner: '@dshfiles/rich-composer',
  methods: {
    list: method({
      input: Schema.Struct({ sessionId: sessionIdSchema }),
      output: Schema.Struct({ annotations: Schema.Array(SentAnnotationSchema) }),
      description: 'Read a thread’s sent annotation history, oldest first.',
      readOnly: true,
    }),
    add: method({
      input: Schema.Struct({
        sessionId: sessionIdSchema,
        text: annotationTextSchema,
        comment: annotationCommentSchema,
        source: annotationSourceSchema,
      }),
      output: Schema.Struct({ annotation: SentAnnotationSchema }),
      description: 'Keep an annotation an accepted message carried.',
    }),
    setComment: method({
      input: Schema.Struct({
        sessionId: sessionIdSchema,
        id: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
        comment: annotationCommentSchema,
      }),
      output: Schema.Struct({ updated: Schema.Boolean }),
      description: 'Rewrite the comment on one sent annotation.',
    }),
    remove: method({
      input: Schema.Struct({
        sessionId: sessionIdSchema,
        id: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      }),
      output: Schema.Struct({ removed: Schema.Boolean }),
      description: 'Drop one sent annotation and its marker.',
    }),
  },
})
