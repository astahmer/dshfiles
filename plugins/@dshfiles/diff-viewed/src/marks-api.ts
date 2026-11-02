import { defineApi, method } from '@dshfiles/dshx/api'
import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'

export const MAX_VIEWED_MARKS = 2000

const sessionIdSchema = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))

const markPositionSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const viewedFileSchema = Schema.Struct({
  sessionId: sessionIdSchema,
  seq: markPositionSchema,
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
})

/**
 * One turn's summary is immutable while its Session lives, so a mark keyed on the
 * Session, the announcing sequence and the path can never outlive the diff it
 * reviewed: a later turn that touches the file again is a new sequence and reads as
 * unviewed.
 */
export const viewedKey = (file: ViewedFile): string => JSON.stringify([file.sessionId, file.seq, file.path])

const viewedKeyPartsSchema = Schema.Tuple([sessionIdSchema, markPositionSchema, Schema.String.check(Schema.isMinLength(1))])

export const viewedFileFromKey = (key: string): ViewedFile | null => {
  let parsed: JsonValue
  try {
    parsed = decodeJson(jsonValueSchema, key)
  } catch {
    return null
  }
  const parts = Schema.decodeUnknownOption(viewedKeyPartsSchema)(parsed)
  return Option.isSome(parts) ? { sessionId: parts.value[0], seq: parts.value[1], path: parts.value[2] } : null
}

const viewedMarksSnapshotSchema = Schema.Struct({
  /** Monotone across Host restarts so a stale read never replaces a newer write. */
  revision: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
  marks: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(MAX_VIEWED_MARKS)),
})

/** The reviewed files of every Session, owned by the Host so every browser, plugin and CLI reads the same progress. */
export const diffViewedApi = defineApi({
  id: 'diff-viewed',
  version: 1,
  owner: '@dshfiles/diff-viewed',
  methods: {
    state: method({
      input: Schema.Void,
      output: viewedMarksSnapshotSchema,
      description: 'Every file marked as viewed, keyed by Session, announcing sequence and path. Read-only.',
    }),
    toggle: method({
      input: viewedFileSchema,
      output: viewedMarksSnapshotSchema,
      description: 'Toggle one file of one review-session change and return the marks it produced.',
    }),
  },
})

export type ViewedFile = typeof viewedFileSchema.Type
export type ViewedMarksSnapshot = typeof viewedMarksSnapshotSchema.Type
