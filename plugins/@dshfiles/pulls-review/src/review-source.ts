import type { ReviewResult } from './api.js'

type ReviewInput = {
  readonly path: string
  readonly base?: string | undefined
  readonly fromChangeId?: string | undefined
  readonly toChangeId?: string | undefined
}

type ReviewHistory = {
  readonly repoRoot: string
  readonly integrations: readonly {
    readonly baseChangeId?: string | undefined
    readonly tipChangeId?: string | undefined
  }[]
}

export const reviewWithHistoryFallback = async (input: {
  readonly path: string
  readonly base?: string | undefined
  readonly readReview: (request: ReviewInput) => Promise<ReviewResult>
  readonly readHistory: (path: string) => Promise<ReviewHistory>
}): Promise<ReviewResult> => {
  const liveReview = await input.readReview({ path: input.path, ...(input.base === undefined ? undefined : { base: input.base }) })
  if (liveReview.status !== 'failed' || liveReview.reason !== 'workspace-missing') return liveReview

  const history = await input.readHistory(input.path).catch(() => undefined)
  const savedRange = history?.integrations.findLast(record => record.baseChangeId !== undefined && record.tipChangeId !== undefined)
  if (history === undefined || savedRange?.baseChangeId === undefined || savedRange.tipChangeId === undefined) return liveReview

  return input.readReview({ path: history.repoRoot, fromChangeId: savedRange.baseChangeId, toChangeId: savedRange.tipChangeId })
}
