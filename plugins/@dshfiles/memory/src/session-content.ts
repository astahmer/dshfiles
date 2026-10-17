import type { SessionSearchHit, SessionSearchPage } from '@deepseek-ai/dsh-session-query'

/** Bounded projection of one full-text page; the finder never sees transport rows. */
export type SessionContentHits = {
  readonly hits: readonly { readonly sessionId: string; readonly snippet: string }[]
  readonly hasMore: boolean
}

/** Decode one session-query page into the finder's content source. */
export const sessionContentHits = (page: SessionSearchPage<SessionSearchHit>): SessionContentHits => ({
  hits: page.items.map(hit => ({ sessionId: hit.header.id, snippet: hit.bestMatch.snippet })),
  hasMore: page.nextCursor !== undefined,
})
