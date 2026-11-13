/** How long a thread tab's Session must stay out of the Session list before its tab closes. */
export const MISSING_THREAD_GRACE_MS = 3_000

/**
 * Decides when a thread tab's Session is really gone. One Session-list snapshot without it is not proof: the list can
 * briefly lose a stored thread (a Host unload reported as a removal, a reconnect's refetch), and closing the tab on that
 * snapshot lost the tab for good. A Session counts as gone once it stayed missing for the whole grace period.
 */
export const createMissingThreads = (graceMs: number = MISSING_THREAD_GRACE_MS) => {
  const since = new Map<string, number>()
  return {
    /**
     * @param missing - Session ids of thread tabs absent from the current list.
     * @param now - the current time in milliseconds.
     * @returns the ids missing for the whole grace period, and in how many milliseconds to look again (null: no wait).
     */
    observe(missing: readonly string[], now: number): { readonly gone: readonly string[]; readonly recheckInMs: number | null } {
      const current = new Set(missing)
      for (const id of since.keys()) if (!current.has(id)) since.delete(id)
      const gone: string[] = []
      let recheckInMs: number | null = null
      for (const id of current) {
        const first = since.get(id) ?? now
        since.set(id, first)
        const left = first + graceMs - now
        if (left <= 0) {
          gone.push(id)
          since.delete(id)
        } else recheckInMs = recheckInMs === null ? left : Math.min(recheckInMs, left)
      }
      return { gone, recheckInMs }
    },
  }
}
