export type AutoSaveStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'saving' }
  | { readonly kind: 'saved'; readonly at: number }
  | { readonly kind: 'error'; readonly message: string }

/**
 * Debounced, serialized persistence for an edited value.
 *
 * The latest scheduled value always wins: a value scheduled while a save runs
 * waits for it and then saves once, so two writes never race and an older one
 * never lands after a newer one. A failed save keeps its value so `retry` can
 * resend it, and a value equal to the last saved one is never written again,
 * which stops a Host-normalized field from re-saving forever.
 */
export const createAutoSaver = <Value>(input: {
  readonly save: (value: Value) => Promise<void>
  readonly equals: (left: Value, right: Value) => boolean
  readonly onStatus: (status: AutoSaveStatus) => void
  readonly delayMs: () => number
  readonly now?: () => number
}) => {
  const now = input.now ?? Date.now
  let pending: { readonly value: Value } | undefined
  let lastSaved: { readonly value: Value } | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let running: Promise<void> | undefined

  const clearTimer = (): void => {
    if (timer === undefined) return
    clearTimeout(timer)
    timer = undefined
  }

  const run = (): Promise<void> => {
    clearTimer()
    if (running !== undefined) return running
    const next = pending
    if (next === undefined) return Promise.resolve()
    pending = undefined
    input.onStatus({ kind: 'saving' })
    const current = input
      .save(next.value)
      .then(
        () => {
          lastSaved = next
          if (pending === undefined) input.onStatus({ kind: 'saved', at: now() })
        },
        (cause: unknown) => {
          pending ??= next
          input.onStatus({ kind: 'error', message: cause instanceof Error ? cause.message : String(cause) })
          return Promise.reject(cause)
        },
      )
      .finally(() => {
        running = undefined
      })
    running = current.then(
      () => (pending === undefined ? undefined : run()),
      () => undefined,
    )
    return running
  }

  return {
    schedule: (value: Value): void => {
      if (lastSaved !== undefined && input.equals(lastSaved.value, value) && running === undefined) {
        pending = undefined
        clearTimer()
        return
      }
      pending = { value }
      input.onStatus({ kind: 'pending' })
      if (running !== undefined) return
      clearTimer()
      timer = setTimeout(() => void run(), input.delayMs())
    },
    /** Save now whatever is waiting, e.g. before the edited account changes. */
    flush: (): Promise<void> => run(),
    retry: (): Promise<void> => run(),
    /** Forget unsaved work, for Revert or a switch to manual mode. */
    cancel: (): void => {
      pending = undefined
      clearTimer()
      input.onStatus({ kind: 'idle' })
    },
    /** Treat a value as already persisted, e.g. after a manual save or a fresh load. */
    markSaved: (value: Value): void => {
      lastSaved = { value }
    },
  }
}

export type AutoSaver<Value> = ReturnType<typeof createAutoSaver<Value>>
