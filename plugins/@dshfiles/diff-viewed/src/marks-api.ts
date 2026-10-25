import { defineApi, method } from '@dshfiles/dshx/api'
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
  let parsed: unknown
  try {
    parsed = JSON.parse(key)
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

/** One file's mark set to an explicit value, for callers that mark while scrolling instead of on a click. */
export const viewedMarkInputSchema = viewedFileSchema.extend({ viewed: z.boolean() }).strict()

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
      tool: { name: 'review_viewed_files', readOnly: true, render: snapshot => `${snapshot.marks.length} files marked viewed` },
    }),
    toggle: method({
      input: viewedFileSchema,
      output: viewedMarksSnapshotSchema,
      description: 'Toggle one file of one review-session change and return the marks it produced.',
    }),
    mark: method({
      input: viewedMarkInputSchema,
      output: viewedMarksSnapshotSchema,
      description:
        'Set one file of one review-session change as viewed or unviewed and return the marks it produced. Idempotent, so a scroll handler can repeat it. Run only when the user asked to change review progress.',
      tool: { name: 'review_mark_viewed', readOnly: false, render: snapshot => `${snapshot.marks.length} files marked viewed` },
    }),
  },
})

export type ViewedFile = z.infer<typeof viewedFileSchema>
export type ViewedFileMark = z.infer<typeof viewedMarkInputSchema>
export type ViewedMarksSnapshot = z.infer<typeof viewedMarksSnapshotSchema>
