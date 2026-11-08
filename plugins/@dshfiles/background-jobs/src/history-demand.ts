/** How long a board read keeps the job-history indexer running. */
const DEMAND_WINDOW_MS = 5 * 60_000

let lastDemand = Date.now()

/**
 * Reading the board is what makes the history index worth its passes. Once nobody has read it for a while the indexer
 * stops, so an idle Host does not keep folding every Session log's job records every thirty seconds.
 */
export const touchHistoryDemand = (): void => {
  lastDemand = Date.now()
}

export const historyDemanded = (): boolean => Date.now() - lastDemand < DEMAND_WINDOW_MS
