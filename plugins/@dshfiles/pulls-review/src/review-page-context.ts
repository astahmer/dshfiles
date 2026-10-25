import type { ReviewSource } from './review-model.js'

/** What the tab hands the main-area page when the user asks for the full page. */
export interface PageReviewContext {
  readonly turn?: Extract<ReviewSource, { kind: 'turn' }> | undefined
  readonly workspacePath?: string | undefined
  readonly sessionId?: string | undefined
}

export interface WorkspaceReviewRequest {
  readonly workspacePath: string
  readonly sessionId: string
}

let current: PageReviewContext | undefined
const listeners = new Set<() => void>()

const setPageReview = (next: PageReviewContext): void => {
  current = next
  for (const listener of listeners) listener()
}

/** Set the exact isolated workspace review before selecting its main-area panel. */
export const requestWorkspaceReview = (request: WorkspaceReviewRequest): void => setPageReview(request)

const readPageReview = (): PageReviewContext | undefined => current

const subscribePageReview = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The review an Expand action hands the main-area page, kept outside React so the panel can be selected in one step. */
export class PageReviewContextModel {
  static readonly set = setPageReview
  static readonly read = readPageReview
  static readonly subscribe = subscribePageReview
}
