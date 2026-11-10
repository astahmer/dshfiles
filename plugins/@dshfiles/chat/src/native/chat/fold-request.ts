/**
 * What this viewport asks its next or running fold batch to own: the reader's content stays still
 * (anchored), or the batch lands at the tail. A running batch carries its own retarget callback, so
 * a tail request can never point at a batch that no longer exists.
 */
export type FoldLanding = 'anchored' | 'tail'

export type FoldRequest =
  | { readonly status: 'none' }
  | { readonly status: 'requested'; readonly landing: FoldLanding }
  | { readonly status: 'running'; readonly landing: FoldLanding; readonly retarget: () => void }

export type FoldRequestEvent =
  | { readonly kind: 'requestTail' }
  | { readonly kind: 'begin'; readonly landing: FoldLanding; readonly retarget: () => void }
  | { readonly kind: 'finish' }

export interface FoldRequestStep {
  readonly request: FoldRequest
  /** The running batch must switch to its tail landing on this transition. */
  readonly retarget: boolean
}

export const noFoldRequest: FoldRequest = { status: 'none' }

/**
 * Apply one request to the pending or running fold batch.
 * @param request - current batch ownership.
 * @param event - a tail request, a batch taking over, or a batch finishing.
 * @returns the next ownership and whether a running batch must retarget now.
 */
export function applyFoldRequest(request: FoldRequest, event: FoldRequestEvent): FoldRequestStep {
  switch (event.kind) {
    case 'requestTail':
      if (request.status === 'running') return { request: { ...request, landing: 'tail' }, retarget: true }
      return { request: { status: 'requested', landing: 'tail' }, retarget: false }
    case 'begin':
      if (request.status === 'running') return { request, retarget: false }
      return { request: { status: 'running', landing: event.landing, retarget: event.retarget }, retarget: false }
    case 'finish':
      return { request: noFoldRequest, retarget: false }
  }
}
