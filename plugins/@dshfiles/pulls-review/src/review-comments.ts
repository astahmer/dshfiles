import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import type { CommentAnchor, CommentThread } from './review-comments-api.js'
import { reviewCommentsApi } from './review-comments-api.js'
import { ReviewModel, type ReviewSource } from './review-model.js'

export interface ReviewComments {
  readonly threads: readonly CommentThread[]
  /** A Host that does not serve the comments API hides the affordances instead of failing. */
  readonly available: boolean
  readonly failed: boolean
  create(path: string, anchor: CommentAnchor, body: string): void
  reply(id: string, body: string): void
  setResolved(id: string, resolved: boolean): void
  remove(id: string): void
}

const message = 'The comment could not be saved.'

/** The comment threads of one review, owned by the Host so the Agent and every browser agree. */
export const useReviewComments = (source: ReviewSource): ReviewComments => {
  const api = useApi(reviewCommentsApi)
  const query = useApiQuery(reviewCommentsApi, 'list', { input: { source: ReviewModel.commentSource(source) } })
  const threads = query.data?.threads ?? []
  const refetch = query.refetch
  const unavailable = query.error?.kind === 'unavailable'
  const run = (operation: Promise<unknown>): void => {
    void operation.then(
      () => refetch(),
      error => console.error('Review comment write failed', { error: error instanceof Error ? error.message.slice(0, 200) : message }),
    )
  }
  return {
    threads,
    available: !unavailable,
    failed: query.status === 'error' && !unavailable,
    create: (path, anchor, body) => run(api.create({ source: ReviewModel.commentSource(source), path, anchor, body })),
    reply: (id, body) => run(api.reply({ id, body })),
    setResolved: (id, resolved) => run(api.setResolved({ id, resolved })),
    remove: id => run(api.delete({ id, confirm: true })),
  }
}
