/** One ephemeral retry wait per running thread. A user-selected account can release the old wait without cancelling or waking the Agent. */
export class RequestRetryWait {
  private readonly waits = new Map<string, (proceed: boolean) => void>()

  wait(sessionId: string, delayMs: number, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false)
    if (delayMs <= 0) return Promise.resolve(true)
    return new Promise(resolve => {
      let finished = false
      const finish = (proceed: boolean): void => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        if (this.waits.get(sessionId) === finish) this.waits.delete(sessionId)
        resolve(proceed)
      }
      const abort = (): void => finish(false)
      const timer = setTimeout(() => finish(true), delayMs)
      timer.unref()
      // Replacement cannot leak an earlier waiter or let its late abort release a new one.
      this.waits.get(sessionId)?.(false)
      this.waits.set(sessionId, finish)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) finish(false)
    })
  }

  release(sessionId: string): void {
    this.waits.get(sessionId)?.(true)
  }
  dispose(): void {
    for (const finish of [...this.waits.values()]) finish(false)
  }
}
