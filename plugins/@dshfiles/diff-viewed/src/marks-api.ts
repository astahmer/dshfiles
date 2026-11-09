import { defineApi, method } from '@dshfiles/dshx/api'
import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { Option } from 'effect'
import * as Schema from 'effect/Schema'

export const MAX_VIEWED_MARKS = 2000
/** Revision-range marks are kept apart from turn marks: one thread review can list thousands of files. */
export const MAX_RANGE_MARKS = 5000
/** One batch write covers a whole review's file list. */
export const MAX_SET_TARGETS = 4000

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

const rangeFields = {
  /** The workspace whose revisions were compared. */
  workspacePath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  /** The base revision or bookmark as the review named it, e.g. `main` or `@-`. */
  base: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  /** The head commit id the review read; a new revision is a new review. */
  head: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
}
const viewedRangeSchema = Schema.Struct(rangeFields)
export type ViewedRange = typeof viewedRangeSchema.Type

const viewedTargetSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('turn'), ...viewedFileSchema.fields }),
  Schema.Struct({ kind: Schema.Literal('range'), ...rangeFields, path: viewedFileSchema.fields.path }),
])
export type ViewedTarget = typeof viewedTargetSchema.Type

/**
 * A revision-range mark: one file of the diff between `base` and the head commit of one workspace. Its first element
 * keeps it apart from a turn mark, whose key is `[sessionId, seq, path]`.
 */
const rangeViewedKey = (range: ViewedRange, path: string): string => JSON.stringify(['range', range.workspacePath, range.base, range.head, path])

const rangeKeyPartsSchema = Schema.Tuple([Schema.Literal('range'), Schema.String, Schema.String, Schema.String, Schema.String.check(Schema.isMinLength(1))])

/** The range and path of a revision-range key, or null for a turn key or anything malformed. */
const rangeFromKey = (key: string): (ViewedRange & { readonly path: string }) | null => {
  if (!key.startsWith('["range",')) return null
  let parsed: JsonValue
  try {
    parsed = decodeJson(jsonValueSchema, key)
  } catch {
    return null
  }
  const parts = Schema.decodeUnknownOption(rangeKeyPartsSchema)(parsed)
  return Option.isSome(parts) ? { workspacePath: parts.value[1], base: parts.value[2], head: parts.value[3], path: parts.value[4] } : null
}

const targetKey = (target: ViewedTarget): string =>
  target.kind === 'turn' ? viewedKey({ sessionId: target.sessionId, seq: target.seq, path: target.path }) : rangeViewedKey(target, target.path)

/** Keys of the one viewed-marks store beyond the turn key: revision-range keys and any target's key. */
export class ViewedKeys {
  static readonly range = rangeViewedKey
  static readonly rangeFromKey = rangeFromKey
  static readonly target = targetKey
}

const rangeMarksSchema = Schema.Struct({
  revision: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
  /** Viewed paths of that range, oldest mark first. */
  paths: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(MAX_RANGE_MARKS)),
})
export type RangeMarks = typeof rangeMarksSchema.Type

const viewedMarksSnapshotSchema = Schema.Struct({
  /** Monotone across Host restarts so a stale read never replaces a newer write. */
  revision: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
  marks: Schema.Array(Schema.String.check(Schema.isMinLength(1))).check(Schema.isMaxLength(MAX_VIEWED_MARKS)),
})

/**
 * The one viewed-marks store: per-turn marks of the native review tab and revision-range marks of the thread Changes
 * facet and the Review page, owned by the Host so every browser, plugin and CLI reads the same progress.
 */
export const diffViewedApi = defineApi({
  id: 'diff-viewed',
  version: 1,
  owner: '@dshfiles/diff-viewed',
  methods: {
    state: method({
      input: Schema.Void,
      output: viewedMarksSnapshotSchema,
      description: 'Every per-turn file mark, keyed by Session, announcing sequence and path. Revision-range marks are read with rangeState. Read-only.',
    }),
    rangeState: method({
      input: viewedRangeSchema,
      output: rangeMarksSchema,
      description: "The files marked viewed in one workspace's diff between a base and a head commit. Read-only.",
      tool: {
        name: 'changes_viewed_files',
        readOnly: true,
        render: output => (output.paths.length === 0 ? 'No files of this review are marked viewed.' : output.paths.join('\n')),
      },
    }),
    set: method({
      input: Schema.Struct({
        targets: Schema.Array(viewedTargetSchema).check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SET_TARGETS)),
        viewed: Schema.Boolean,
      }),
      output: Schema.Struct({ revision: rangeMarksSchema.fields.revision, changed: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)) }),
      description: 'Mark files of one turn or one revision range viewed, or not viewed, in one request.',
      tool: {
        name: 'changes_mark_viewed',
        description:
          "Mark changed files viewed (viewed: true) or not viewed (viewed: false) in a thread's review: per turn (sessionId, seq, path) or per revision range (workspacePath, base, head commit, path). Run only when the user asked to change review marks; viewed: false reverses it.",
        render: output => `${String(output.changed)} mark(s) changed.`,
      },
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
