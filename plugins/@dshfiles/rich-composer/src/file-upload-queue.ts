/** One waiting upload: `start` is the work, `settle` releases the caller's completion promise. */
export interface QueuedTask {
  readonly start: () => Promise<void>
  readonly settle: () => void
}

/** Runs at most `maxConcurrent` tasks; a pushed task waits without starting until a slot frees. */
export class TaskQueue {
  private readonly waiting: QueuedTask[] = []
  private running = 0
  constructor(private readonly maxConcurrent: number) {}

  /** Tasks still waiting for a slot, not counting the running ones. */
  get waitingCount(): number {
    return this.waiting.length
  }

  push(task: QueuedTask): void {
    this.waiting.push(task)
    this.pump()
  }

  /** Drop every waiting task; a running one still settles through its own finally. */
  clear(): void {
    this.waiting.length = 0
  }

  private pump(): void {
    while (this.running < this.maxConcurrent) {
      const task = this.waiting.shift()
      if (task === undefined) return
      this.running += 1
      void task.start().finally(() => {
        this.running -= 1
        task.settle()
        this.pump()
      })
    }
  }
}
