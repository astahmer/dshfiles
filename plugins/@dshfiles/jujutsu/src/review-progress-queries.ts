import type { ReviewProgressSnapshot } from './review-progress-api.js'

export const latestReviewProgressSnapshot = (current: ReviewProgressSnapshot | undefined, incoming: ReviewProgressSnapshot): ReviewProgressSnapshot =>
  current === undefined || incoming.revision > current.revision ? incoming : current
