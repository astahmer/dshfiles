import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { reviewFileSchema, reviewStoreSchema } from './review-progress.js'

const reviewProgressSnapshotSchema = z
  .object({
    /** Monotone across Host restarts so a stale read never replaces a newer write. */
    revision: z.number().int().positive(),
    store: reviewStoreSchema,
  })
  .strict()

const reviewProgressToggleSchema = z
  .object({
    repositoryRoot: z.string().min(1).max(2048),
    commitId: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    file: reviewFileSchema,
    reviewed: z.boolean(),
  })
  .strict()

export const jujutsuReviewProgressApi = defineApi({
  id: 'jujutsu-review-progress',
  version: 1,
  owner: '@dshfiles/jujutsu',
  methods: {
    state: method({
      input: z.void(),
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

export type ReviewProgressSnapshot = z.infer<typeof reviewProgressSnapshotSchema>
export type ReviewProgressToggle = z.infer<typeof reviewProgressToggleSchema>
