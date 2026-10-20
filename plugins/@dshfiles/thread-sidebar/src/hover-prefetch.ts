/** How long the pointer rests on a row before its thread is warmed; a pass across the list warms nothing. */
const DWELL_MS = 150
/** A warmed thread stays warm on the Host about this long (its kept log tail lives two minutes). */
const REWARM_AFTER_MS = 60_000

/**
 * Warms a thread on the Host while the pointer rests on its sidebar row, so the click opens a log tail that is
 * already read and scanned.
 */
export class HoverPrefetch {
  static install(input: {
    readonly root: EventTarget
    /** The thread id of the row an event happened in, or null outside thread rows. */
    readonly rowIdOf: (event: Event) => string | null
    readonly warm: (sessionId: string) => void
    readonly now?: () => number
  }): () => void {
    const now = input.now ?? Date.now
    const warmedAt = new Map<string, number>()
    let pending: { readonly sessionId: string; readonly timer: ReturnType<typeof setTimeout> } | undefined
    const cancel = (): void => {
      if (pending !== undefined) clearTimeout(pending.timer)
      pending = undefined
    }
    const onOver = (event: Event): void => {
      const sessionId = input.rowIdOf(event)
      if (pending?.sessionId === sessionId) return
      cancel()
      if (sessionId === null || sessionId === '') return
      if (now() - (warmedAt.get(sessionId) ?? Number.NEGATIVE_INFINITY) < REWARM_AFTER_MS) return
      pending = {
        sessionId,
        timer: setTimeout(() => {
          pending = undefined
          warmedAt.set(sessionId, now())
          input.warm(sessionId)
        }, DWELL_MS),
      }
    }
    input.root.addEventListener('pointerover', onOver)
    input.root.addEventListener('pointerleave', cancel)
    return () => {
      cancel()
      input.root.removeEventListener('pointerover', onOver)
      input.root.removeEventListener('pointerleave', cancel)
    }
  }
}
