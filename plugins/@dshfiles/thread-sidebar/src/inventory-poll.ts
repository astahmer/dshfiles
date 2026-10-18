export interface InventoryPoll {
  /** Want to run: arms the timer when the page is visible and the owner is available. */
  start(): void
  /** Stop for good; the pending timer is cancelled. */
  stop(): void
  /** A missing API owner stops the timer instead of repeating a request that cannot succeed. */
  setAvailable(available: boolean): void
  /** The page became visible or hidden: catch up once on return, and wait while hidden. */
  visibilityChanged(): void
}

/**
 * The sidebar inventory timer. It refreshes on its own schedule while the page is visible and the API owner answers,
 * waits while the tab is hidden, refreshes once on return so the badges are not stale, and stops for good when the
 * owner is missing — a raw interval kept polling a Host that no longer serves the API.
 */
export const createInventoryPoll = (input: {
  readonly refresh: () => void
  readonly intervalMs: number
  readonly isHidden: () => boolean
  readonly schedule: (callback: () => void, delayMs: number) => number
  readonly cancel: (handle: number) => void
}): InventoryPoll => {
  let running = false
  let available = true
  let handle: number | undefined
  /** Set while the tab is hidden, so a return refreshes once and other visibility events change nothing. */
  let waitingForVisibility = false

  const cancel = (): void => {
    if (handle === undefined) return
    input.cancel(handle)
    handle = undefined
  }

  const active = (): boolean => running && available && !input.isHidden()

  const tick = (): void => {
    handle = undefined
    if (!active()) return
    input.refresh()
    if (active()) handle = input.schedule(tick, input.intervalMs)
  }

  const arm = (): void => {
    if (!running || !available) return
    // Hidden: remember it, so the return from this tab is the event that catches up.
    if (input.isHidden()) {
      waitingForVisibility = true
      return
    }
    if (handle !== undefined) return
    handle = input.schedule(tick, input.intervalMs)
  }

  return {
    start: () => {
      running = true
      arm()
    },
    stop: () => {
      running = false
      cancel()
    },
    setAvailable: next => {
      available = next
      if (active()) arm()
      else cancel()
    },
    visibilityChanged: () => {
      if (!running || !available) return
      if (input.isHidden()) {
        waitingForVisibility = true
        cancel()
        return
      }
      // Only the return from a hidden tab catches up; any other visibility event leaves the schedule alone.
      if (!waitingForVisibility) {
        arm()
        return
      }
      waitingForVisibility = false
      input.refresh()
      cancel()
      arm()
    },
  }
}
