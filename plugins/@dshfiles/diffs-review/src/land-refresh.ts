/** What the Land card does once a land (or a queue change) settled. */
export interface LandRefreshPorts {
  /** Refetch this plugin's own queries (the Land card's status and the next ready thread). */
  readonly invalidateOwn: () => void
  /** jj-integration's repository-moved event: the thread list, the jj panel and the changes chips refetch now. */
  readonly announceRepositoryChange: () => void
  /** The facet's own follow-up (scroll, focus, the next thread). */
  readonly onLanded: () => void
}

/**
 * A land rewrites jj history that other plugins show. Refreshing only the Land card's queries left the landed thread's
 * row reading "2 to land" until the thread list's next inventory poll; announcing the change makes every reader
 * refetch at once (upstream UI fit, item 10).
 */
export const afterLand = (ports: LandRefreshPorts): void => {
  ports.invalidateOwn()
  ports.announceRepositoryChange()
  ports.onLanded()
}
