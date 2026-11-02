import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { fileStatusSchema } from './api.js'
import { SchemaHelpers } from './schema-helpers.js'

const bookmarkNameSchema = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._/+:-]{0,254}$/))

/** What the composer bar compares the working copy against. */
export const composerBaseSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('parent') }),
  Schema.Struct({ kind: Schema.Literal('trunk') }),
  Schema.Struct({ kind: Schema.Literal('bookmark'), name: bookmarkNameSchema }),
  Schema.Struct({ kind: Schema.Literal('remoteBookmark'), name: bookmarkNameSchema, remote: bookmarkNameSchema }),
])

const cwdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))

const repositorySchema = Schema.Struct({
  root: Schema.String.check(Schema.isMaxLength(2048)),
  workspace: Schema.NullOr(Schema.String.check(Schema.isMaxLength(128))),
  changeId: Schema.String.check(Schema.isMaxLength(64)),
  commitId: Schema.String.check(Schema.isMaxLength(64)),
  description: Schema.String.check(Schema.isMaxLength(500)),
  empty: Schema.Boolean,
  conflict: Schema.Boolean,
  bookmarks: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(32)),
  nearestBookmarks: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(32)),
  base: Schema.Struct({
    label: Schema.String.check(Schema.isMaxLength(256)),
    found: Schema.Boolean,
  }),
  revisionCounts: Schema.optionalKey(
    Schema.NullOr(
      SchemaHelpers.strictStruct(
        Schema.Struct({
          ahead: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
          behind: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
        }),
      ),
    ),
  ),
  totals: Schema.NullOr(
    Schema.Struct({
      files: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      additions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
      deletions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    }),
  ),
  files: Schema.Array(Schema.Struct({ path: Schema.String.check(Schema.isMaxLength(2048)), status: fileStatusSchema })).check(Schema.isMaxLength(500)),
  filesTruncated: Schema.Boolean,
  localBookmarks: Schema.Array(Schema.String.check(Schema.isMaxLength(256))).check(Schema.isMaxLength(200)),
  remoteBookmarks: Schema.optionalKey(
    Schema.Array(Schema.Struct({ name: Schema.String.check(Schema.isMaxLength(256)), remote: Schema.String.check(Schema.isMaxLength(256)) })).check(
      Schema.isMaxLength(200),
    ),
  ),
})

export const composerContextApi = defineApi({
  id: 'jujutsu-composer',
  version: 1,
  methods: {
    context: method({
      input: Schema.Struct({ cwd: cwdSchema, base: composerBaseSchema }),
      output: Schema.Struct({ repository: Schema.NullOr(repositorySchema) }),
    }),
    diff: method({
      input: Schema.Struct({ cwd: cwdSchema, base: composerBaseSchema }),
      output: Schema.Struct({
        patch: Schema.String.check(Schema.isMaxLength(1_200_000)),
        truncated: Schema.Boolean,
        files: Schema.Array(
          Schema.Struct({
            path: Schema.String.check(Schema.isMaxLength(2048)),
            additions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
            deletions: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
          }),
        ).check(Schema.isMaxLength(2000)),
      }),
    }),
  },
})

export type ComposerBase = Schema.Schema.Type<typeof composerBaseSchema>
export type ComposerRepository = Schema.Schema.Type<typeof repositorySchema>
