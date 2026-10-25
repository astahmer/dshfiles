import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { MAX_FILES } from './api.js'

export const NO_REVIEWED: Record<string, string[]> = {}

/** Locally persisted reviewed marks for a workspace review, keyed as {@link ReviewedMarksModel.keyOf} builds. */
export const reviewedStore = createStoredValue({
  key: 'dshfiles-pulls-review:reviewed',
  schema: z.record(z.string(), z.array(z.string().max(2048)).max(MAX_FILES)),
  fallback: NO_REVIEWED,
})
