/**
 * One short-lived `/plugins/events` connection, opened when the page comes back, so the notice re-reads the Host's
 * pending list without a reload. The live stream keeps running; this only borrows the connect frames.
 */

/** The slice of `EventSource` this needs, so a test can stand in for the browser's. */
export interface RereadStream {
  readonly onMessage: (listener: (data: string) => void) => void
  readonly onError: (listener: () => void) => void
  readonly close: () => void
}

export interface PendingRereadOptions {
  readonly open: () => RereadStream
  /** Handles one frame; true once it delivered the pending list. */
  readonly receive: (data: string) => boolean
  /** A Host that never answers must not leave the borrowed connection open. */
  readonly timeoutMs: number
}

export interface PendingReread {
  /** Open one borrowed stream, unless one is already open. */
  readonly reread: () => void
  readonly dispose: () => void
}

export const createPendingReread = (options: PendingRereadOptions): PendingReread => {
  let stream: RereadStream | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  const finish = (): void => {
    stream?.close()
    stream = undefined
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = undefined
  }
  const reread = (): void => {
    if (stream !== undefined) return
    const next = options.open()
    stream = next
    next.onMessage(data => {
      if (options.receive(data)) finish()
    })
    next.onError(finish)
    timeout = setTimeout(finish, options.timeoutMs)
  }
  return { reread, dispose: finish }
}
