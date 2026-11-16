import type { SessionEventLikeEntry } from '../contract/events.ts'
import type { ClientSessionPageRequest } from '../transport.ts'

/** The event window a reader already holds, measured in the units a follow request can ask for. */
export interface HeldWindow {
  /** Turn starts inside the window. */
  readonly turnStarts: number
  /** Window entries: an upper bound of the messages it holds. */
  readonly entries: number
}

/** Measure the held window; undefined while it holds nothing. */
export const heldWindowOf = (entries: readonly SessionEventLikeEntry[]): HeldWindow | undefined => {
  if (entries.length === 0) return undefined
  let turnStarts = 0
  for (const entry of entries) if (entry.event.type === 'turn/start') turnStarts += 1
  return { turnStarts, entries: entries.length }
}

/**
 * The follow request that reopens a journal after a carrier loss. Its snapshot replaces the window the reader holds,
 * and the opening request names only the newest Turn: a phone that slept would wake to its last Turn alone, with the
 * rest of the transcript gone. Ask for every held Turn plus one, which covers a partial leading Turn or one Turn
 * started while the page slept, and allow as many messages as the window holds plus the opening allowance.
 * @param request - the opening request this stream repairs.
 * @param held - the window the reader holds now.
 * @returns a request whose snapshot reaches back at least as far as the held window, short of a long absence.
 */
export const coveringRequest = (request: ClientSessionPageRequest, held: HeldWindow | undefined): ClientSessionPageRequest => {
  const window = request.turnWindow
  if (held === undefined || window === undefined) return request
  const allowance = request.maxMessages ?? window.minMessages
  return {
    ...request,
    maxMessages: held.entries + allowance,
    turnWindow: { ...window, minTurns: Math.max(window.minTurns, held.turnStarts + 1) },
  }
}
