export interface CoalescedWrite<Value> {
  /** Record how to produce the newest value; the reader runs once when the window closes or on a flush. */
  set(read: () => Value): void
  /** Write the pending value now — unmount, `pagehide` — and cancel the timer. */
  flush(): void
  /** Drop the pending value without writing. */
  cancel(): void
}

/**
 * Owner-local write coalescing. A drag or resize emits layout events continuously, and each one serializing the whole
 * layout into storage also publishes it to every listener; one write per window keeps the newest value and a flush
 * guarantees the last state is never dropped. This is deliberately not a global setter policy: other stores need
 * immediate durability.
 */
export const createCoalescedWrite = <Value>(input: {
  readonly write: (value: Value) => void
  readonly delayMs: number
  readonly schedule: (callback: () => void, delayMs: number) => number
  readonly cancel: (handle: number) => void
}): CoalescedWrite<Value> => {
  let read: (() => Value) | undefined
  let handle: number | undefined

  const clear = (): void => {
    if (handle === undefined) return
    input.cancel(handle)
    handle = undefined
  }

  const take = (): void => {
    clear()
    // oxlint-disable-next-line antislop/no-passthrough-variable -- Clear before writing: a write that records a new value must open its own window.
    const next = read
    read = undefined
    if (next !== undefined) input.write(next())
  }

  return {
    set: next => {
      read = next
      if (handle !== undefined) return
      handle = input.schedule(() => {
        handle = undefined
        take()
      }, input.delayMs)
    },
    flush: take,
    cancel: () => {
      clear()
      read = undefined
    },
  }
}
