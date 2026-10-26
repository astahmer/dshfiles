import { defineApi, method } from '@dshfiles/dshx/api'
import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { z } from 'zod'

export const MAX_VIEWED_MARKS = 2000

const sessionIdSchema = z.string().min(1).max(128)

export const viewedFileSchema = z
  .object({
    sessionId: sessionIdSchema,
    seq: z.number().int().nonnegative(),
    path: z.string().min(1).max(4096),
  })
  .strict()

/**
 * One turn's summary is immutable while its Session lives, so a mark keyed on the
 * Session, the announcing sequence and the path can never outlive the diff it
 * reviewed: a later turn that touches the file again is a new sequence and reads as
 * unviewed.
 */
export const viewedKey = (file: ViewedFile): string => JSON.stringify([file.sessionId, file.seq, file.path])

const viewedKeyPartsSchema = z.tuple([sessionIdSchema, z.number().int().nonnegative(), z.string().min(1)])

export const viewedFileFromKey = (key: string): ViewedFile | null => {
  let parsed: JsonValue
  try {
    parsed = decodeJson(jsonValueSchema, key)
  } catch {
    return null
  }
  const parts = viewedKeyPartsSchema.safeParse(parsed)
  return parts.success ? { sessionId: parts.data[0], seq: parts.data[1], path: parts.data[2] } : null
}

export const viewedMarksSnapshotSchema = z
  .object({
    /** Monotone across Host restarts so a stale read never replaces a newer write. */
    revision: z.number().int().positive(),
    marks: z.array(z.string().min(1)).max(MAX_VIEWED_MARKS),
  })
  .strict()

/** The reviewed files of every Session, owned by the Host so every browser, plugin and CLI reads the same progress. */
export const diffViewedApi = defineApi({
  id: 'diff-viewed',
  version: 1,
  owner: '@dshfiles/diff-viewed',
  methods: {
    state: method({
      input: z.void(),
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

export type ViewedFile = z.infer<typeof viewedFileSchema>
export type ViewedMarksSnapshot = z.infer<typeof viewedMarksSnapshotSchema>
