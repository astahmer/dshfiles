import { createSource, type Subscribable, type ToastInput, type ToastsService } from '@dshfiles/dshx/client'

const DEFAULT_DURATION_MS = 5000
/** A replaced toast leaves in the kit's exit time (`--dshx-duration-exit`) before the newer one shows. */
export const TOAST_EXIT_MS = 100

export interface ToastEntry {
  readonly id: number
  readonly input: ToastInput
  /** The toast is leaving because a newer one replaces it; it renders closed for `TOAST_EXIT_MS`. */
  readonly leaving?: boolean
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

/**
 * A toast a newer one may replace: a confirmation or note that closes on its own and offers nothing to do. A failure is
 * never dropped, and a toast with an action (Undo) or no timeout keeps its place.
 */
const replaceable = (entry: ToastEntry): boolean => entry.input.tone !== 'danger' && durationOf(entry) > 0 && entry.input.action === undefined

export const createToastStack = (): ToastStack => {
  const toasts = createSource<readonly ToastEntry[]>(NONE)
  /** Every toast not yet dismissed, oldest first; one of them is on screen. */
  let queue: readonly ToastEntry[] = []
  /** The countdown of the toast on screen: a queued toast gets its full time once it shows. */
  let timer: { readonly id: number; readonly handle: ReturnType<typeof setTimeout> } | undefined
  /** The exit of a replaced toast; the next toast shows when it ends. */
  let leaving: ReturnType<typeof setTimeout> | undefined
  let nextId = 0

  /**
   * A failure shows first, so an error never waits behind confirmations. Then the oldest toast that closes on its own,
   * so a sticky one never holds back a confirmation. A toast that gives way gets its full time when it returns.
   */
  const pick = (): ToastEntry | undefined => queue.find(entry => entry.input.tone === 'danger') ?? queue.find(entry => durationOf(entry) > 0) ?? queue[0]

  const show = (): void => {
    if (leaving !== undefined) return
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

  /** The toast on screen leaves (100 ms exit) and is dropped, so the newer one shows instead of waiting its 5 s. */
  const replaceShown = (): void => {
    const shown = toasts.get()[0]
    if (shown === undefined || shown.leaving === true || leaving !== undefined || !replaceable(shown)) return
    queue = queue.filter(entry => entry.id !== shown.id)
    if (timer !== undefined) clearTimeout(timer.handle)
    timer = undefined
    toasts.set([{ ...shown, leaving: true }])
    leaving = setTimeout(() => {
      leaving = undefined
      show()
    }, TOAST_EXIT_MS)
  }

  const service: ToastsService = {
    show: input => {
      const id = nextId++
      queue = [...queue, { id, input }]
      if (input.tone !== 'danger') replaceShown()
      show()
      return () => dismiss(id)
    },
  }

  const dispose = (): void => {
    if (timer !== undefined) clearTimeout(timer.handle)
    if (leaving !== undefined) clearTimeout(leaving)
    timer = undefined
    leaving = undefined
    queue = []
    toasts.set(NONE)
  }

  return { service, toasts, dismiss, dispose }
}
