import type { PreviewPageView } from './api.js'

/** One `preview_reveal` (or `preview_open` with reveal) of a page. */
export interface RevealRequest {
  readonly pageId: string
  readonly url: string
  readonly requestedAt: number
}

/** The key to record once the pane took a reveal, and whether a refused one should be tried again shortly. */
interface RevealAttempt {
  readonly shown: string | undefined
  readonly retry: boolean
}

const revealKey = (input: { readonly sessionId: string; readonly request: RevealRequest }): string =>
  `reveal:${input.sessionId}:${input.request.pageId}:${String(input.request.requestedAt)}`

/**
 * Show the newest reveal this browser has not shown yet, from the pushed event or the page list, in the pane.
 *
 * A reveal is state, not an edge: the event is not replayed after a reconnect and the pane refuses while the
 * on-screen Session's surface is not minted yet, so a request counts as shown only once the pane took it.
 * @param input - the thread, its latest pushed reveal, its listed pages, the keys already shown, whether the thread is
 *   on screen, and the pane's opener.
 * @returns what to record and whether to retry.
 */
const attempt = (input: {
  readonly sessionId: string
  readonly pushed: RevealRequest | null
  readonly pages: readonly PreviewPageView[]
  readonly shown: ReadonlySet<string>
  readonly onScreen: boolean
  readonly open: (url: string) => boolean
}): RevealAttempt => {
  const listed = input.pages.flatMap(page =>
    page.revealRequestedAt === null ? [] : [{ pageId: page.pageId, url: page.url, requestedAt: page.revealRequestedAt }],
  )
  const newest = [...listed, ...(input.pushed === null ? [] : [input.pushed])].reduce<RevealRequest | undefined>(
    (latest, request) => (latest === undefined || request.requestedAt > latest.requestedAt ? request : latest),
    undefined,
  )
  if (newest === undefined || !input.onScreen) return { shown: undefined, retry: false }
  const key = revealKey({ sessionId: input.sessionId, request: newest })
  if (input.shown.has(key)) return { shown: undefined, retry: false }
  return input.open(newest.url) ? { shown: key, retry: false } : { shown: undefined, retry: true }
}

export class PreviewReveal {
  static readonly attempt = attempt
}
