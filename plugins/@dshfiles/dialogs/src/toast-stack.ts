import { createSource, type Subscribable, type ToastInput, type ToastsService } from '@dshfiles/dshx/client'

const DEFAULT_DURATION_MS = 5000

export interface ToastEntry {
  readonly id: number
  readonly input: ToastInput
}

export interface ToastStack {
  readonly service: ToastsService
  /** Oldest first. */
  readonly toasts: Subscribable<readonly ToastEntry[]>
  dismiss(id: number): void
  /** Clears every toast and its timer when the plugin ends. */
  dispose(): void
}

export const createToastStack = (): ToastStack => {
  const toasts = createSource<readonly ToastEntry[]>([])
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  let nextId = 0

  const dismiss = (id: number): void => {
    clearTimeout(timers.get(id))
    timers.delete(id)
    const remaining = toasts.get().filter(entry => entry.id !== id)
    if (remaining.length !== toasts.get().length) toasts.set(remaining)
  }

  const service: ToastsService = {
    show: input => {
      const id = nextId++
      toasts.set([...toasts.get(), { id, input }])
      const duration = input.duration ?? DEFAULT_DURATION_MS
      if (duration > 0)
        timers.set(
          id,
          setTimeout(() => dismiss(id), duration),
        )
      return () => dismiss(id)
    },
  }

  const dispose = (): void => {
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
    toasts.set([])
  }

  return { service, toasts, dismiss, dispose }
}
