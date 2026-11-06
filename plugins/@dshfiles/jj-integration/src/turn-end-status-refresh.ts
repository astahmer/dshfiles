/**
 * The newest Turn's tail reads the thread status while the Turn runs, so its cached answer predates the work the Turn
 * described. One read at the moment the Turn ends is what makes the integration offer appear at once instead of after
 * the fallback poll; this keeps that read to one per Turn and skips Tails mounted after their Turn already ended,
 * which the query read fresh on mount.
 */

/** Where the newest Turn's refresh stands: nothing yet, one read in flight, or that Turn end already read. */
export type TurnEndStatusRefresh =
  | { readonly phase: 'waiting' }
  | { readonly phase: 'refreshing'; readonly endedAt: number; readonly baseline: number }
  | { readonly phase: 'settled'; readonly endedAt: number }

/** A tail mounted after its Turn ended reads the fresh status on mount, so it never asks for the refresh. */
export const turnEndRefreshOnMount = (endedAt: number | undefined): TurnEndStatusRefresh =>
  endedAt === undefined ? { phase: 'waiting' } : { phase: 'settled', endedAt }

/**
 * A new Turn end takes one read, identified by the last update time it starts from.
 * @returns `state` itself when this end was already taken or the Turn is not over.
 */
export const turnEndRefreshOnEnd = (
  state: TurnEndStatusRefresh,
  input: { readonly newestTurnHasEnded: boolean; readonly endedAt: number | undefined; readonly baseline: number },
): TurnEndStatusRefresh => {
  if (!input.newestTurnHasEnded || input.endedAt === undefined) return state
  if (state.phase !== 'waiting' && state.endedAt === input.endedAt) return state
  return { phase: 'refreshing', endedAt: input.endedAt, baseline: input.baseline }
}

/** A status read newer than the one the refresh started from settles it. */
export const turnEndRefreshStatusRead = (state: TurnEndStatusRefresh, dataUpdatedAt: number): TurnEndStatusRefresh =>
  state.phase === 'refreshing' && dataUpdatedAt > state.baseline ? { phase: 'settled', endedAt: state.endedAt } : state

/** The offer waits for the refresh it asked for, so a stale cached status cannot hide it. */
export const turnEndRefreshPending = (state: TurnEndStatusRefresh): boolean => state.phase === 'refreshing'
