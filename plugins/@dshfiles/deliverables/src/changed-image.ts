/** The route serving a listed changed image's current bytes. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Authenticated GET route serving one listed image file's current bytes while its Session lives. */
export const CHANGES_IMAGE_PATH = '/api/changes.image'

/**
 * Document-relative address of one listed file's current image bytes.
 * @param input - owning Session, announcing event sequence, and the file's index in the summary.
 * @returns the route with its query.
 */
export const changesImageUrl = (input: { readonly sessionId: SessionId; readonly seq: number; readonly index: number }): string =>
  `${CHANGES_IMAGE_PATH.slice(1)}?${new URLSearchParams({ sessionId: input.sessionId, seq: String(input.seq), index: String(input.index) })}`
