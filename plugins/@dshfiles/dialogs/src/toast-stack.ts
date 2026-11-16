import { createSource, type Subscribable, type ToastInput, type ToastsService } from '@dshfiles/dshx/client'

const DEFAULT_DURATION_MS = 5000

export interface ToastEntry {
  readonly id: number
  readonly input: ToastInput
}

export interface ToastStack {
  readonly service: ToastsService
  /** The toast on screen: at most one. The rest wait their turn (UX plan R9: one toast at a time). */
  readonly toasts: Subscribable<readonly ToastEntry[]>
  dismiss(id: number): void
  /** Clears every toast and its timer when the plugin ends. */
  dispose(): void
}

const NONE: readonly ToastEntry[] = []
const durationOf = (entry: ToastEntry): number => entry.input.duration ?? DEFAULT_DURATION_MS

export const createToastStack = (): ToastStack => {
  const toasts = createSource<readonly ToastEntry[]>(NONE)
  /** Every toast not yet dismissed, oldest first; one of them is on screen. */
  let queue: readonly ToastEntry[] = []
  /** The countdown of the toast on screen: a queued toast gets its full time once it shows. */
  let timer: { readonly id: number; readonly handle: ReturnType<typeof setTimeout> } | undefined
  let nextId = 0

  /**
   * A failure shows first, so an error never waits behind confirmations. Then the oldest toast that closes on its own,
   * so a sticky one never holds back a confirmation. A toast that gives way gets its full time when it returns.
   */
  const pick = (): ToastEntry | undefined => queue.find(entry => entry.input.tone === 'danger') ?? queue.find(entry => durationOf(entry) > 0) ?? queue[0]

  const show = (): void => {
    const shown = toasts.get()[0]
    const next = pick()
    if (shown?.id === next?.id) return
    if (timer !== undefined) clearTimeout(timer.handle)
    timer = undefined
    toasts.set(next === undefined ? NONE : [next])
    if (next === undefined || durationOf(next) <= 0) return
    timer = { id: next.id, handle: setTimeout(() => dismiss(next.id), durationOf(next)) }
  }

  const dismiss = (id: number): void => {
    const remaining = queue.filter(entry => entry.id !== id)
    if (remaining.length === queue.length) return
    queue = remaining
    show()
  }

  const service: ToastsService = {
    show: input => {
      const id = nextId++
      queue = [...queue, { id, input }]
      show()
      return () => dismiss(id)
    },
  }

  const dispose = (): void => {
    if (timer !== undefined) clearTimeout(timer.handle)
    timer = undefined
    queue = []
    toasts.set(NONE)
  }

  return { service, toasts, dismiss, dispose }
}
