import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { reviewFileSchema, reviewStoreSchema } from './review-progress.js'
import { SchemaHelpers } from './schema-helpers.js'

const reviewProgressSnapshotSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    /** Monotone across Host restarts so a stale read never replaces a newer write. */
    revision: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
    store: reviewStoreSchema,
  }),
)

const reviewProgressToggleSchema = SchemaHelpers.strictStruct(
  Schema.Struct({
    repositoryRoot: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
    commitId: Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)),
    file: reviewFileSchema,
    reviewed: Schema.Boolean,
  }),
)

export const jujutsuReviewProgressApi = defineApi({
  id: 'jujutsu-review-progress',
  version: 1,
  owner: '@dshfiles/jujutsu',
  methods: {
    state: method({
      input: Schema.Void,
      output: reviewProgressSnapshotSchema,
      description: 'Files of which revisions were marked reviewed, keyed to the exact reviewed content. Read-only.',
    }),
    toggle: method({
      input: reviewProgressToggleSchema,
      output: reviewProgressSnapshotSchema,
      description: 'Mark or unmark one file of one revision reviewed. The Host stamps the review time.',
    }),
  },
})

export type ReviewProgressSnapshot = Schema.Schema.Type<typeof reviewProgressSnapshotSchema>
export type ReviewProgressToggle = Schema.Schema.Type<typeof reviewProgressToggleSchema>
