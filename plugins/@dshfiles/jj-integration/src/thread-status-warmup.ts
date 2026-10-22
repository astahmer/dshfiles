/**
 * Re-reads a thread's jj status while its Session works, so the Turn-tail read that asks for it once the Turn ends is
 * answered from the read cache instead of spawning jj then. A Turn streams many events, so this coalesces bursts and
 * keeps at most one read in flight per workspace; a read that lands during the final step is reused by the offer.
 */
const MAX_TRACKED_PATHS = 512

export class ThreadStatusWarmup {
  private readonly lastStartedAt = new Map<string, number>()
  private readonly inFlight = new Set<string>()
  private disposed = false
  private readonly options: {
    readonly read: (path: string) => Promise<void>
    readonly now?: () => number
    readonly intervalMs?: number
    readonly report?: (error: unknown) => void
  }

  constructor(options: {
    readonly read: (path: string) => Promise<void>
    readonly now?: () => number
    readonly intervalMs?: number
    readonly report?: (error: unknown) => void
  }) {
    this.options = options
  }

  /** Ask for a read unless this workspace was read moments ago or one still runs. Never throws. */
  schedule(path: string): void {
    if (this.disposed || this.inFlight.has(path)) return
    const now = this.options.now?.() ?? Date.now()
    const last = this.lastStartedAt.get(path)
    if (last !== undefined && now - last < (this.options.intervalMs ?? 750)) return
    this.remember(path, now)
    const read = this.options
      .read(path)
      .then(
        () => undefined,
        error => {
          this.options.report?.(error)
        },
      )
      .finally(() => this.inFlight.delete(path))
    this.inFlight.add(path)
    void read
  }

  /** Stop scheduling and drop the bookkeeping; reads already started finish on their own. */
  dispose(): void {
    this.disposed = true
    this.inFlight.clear()
    this.lastStartedAt.clear()
  }

  /** Keeps the throttling map bounded on a store with many thread workspaces. */
  private remember(path: string, at: number): void {
    this.lastStartedAt.set(path, at)
    if (this.lastStartedAt.size <= MAX_TRACKED_PATHS) return
    const oldest = this.lastStartedAt.keys().next().value
    if (oldest !== undefined) this.lastStartedAt.delete(oldest)
  }
}
