/**
 * When the page may take a plugin code update.
 *
 * A hot swap of the packages that draw the open thread withdraws its conversation hooks until the new modules load,
 * and a reload repaints the whole page. A phone that wakes gets every rebuild it slept through at once, over a tunnel
 * that is still reconnecting, so the thread went blank in front of the reader. Updates now wait for a moment the
 * reader cannot see: the page hidden, or the reader idle. None applies before the connection is live again.
 */

/** The `applyUpdates` setting. `auto` holds every update on a phone and only thread-drawing ones on a desktop. */
export type ApplyUpdates = 'auto' | 'immediately' | 'when-hidden-or-idle'

/** Packages whose swap blanks the open thread until their new modules load. */
export const THREAD_PACKAGES: readonly string[] = ['@dshfiles/chat', '@dshfiles/workbench', '@dshfiles/rich-composer', '@dshfiles/session-controller']

/** After the page comes back, it shows the reader what they left; updates wait this long at least. */
export const RESUME_GRACE_MS = 10_000

/** A reader who has not touched the page this long is not reading it closely enough to notice a swap. */
export const IDLE_MS = 30_000

/** What the page is doing now, as the browser half observes it. */
export interface PageMoment {
  readonly now: number
  readonly hidden: boolean
  /** The window has focus (`document.hasFocus()`): visible and in front of the reader. */
  readonly focused: boolean
  readonly connected: boolean
  readonly phone: boolean
  /** When the page last became visible (load included). */
  readonly visibleSince: number
  /** Last pointer, key, wheel, touch or scroll input. */
  readonly lastInputAt: number
  /** A focused field: the composer or any other editor. */
  readonly editing: boolean
  /** A pointer is down. */
  readonly pointerActive: boolean
}

type Policy = 'live' | 'live-except-thread' | 'hidden-or-idle'

const policyOf = (mode: ApplyUpdates, phone: boolean): Policy => {
  if (mode === 'immediately') return 'live'
  if (mode === 'when-hidden-or-idle' || phone) return 'hidden-or-idle'
  return 'live-except-thread'
}

const resuming = (page: PageMoment): boolean => page.now - page.visibleSince < RESUME_GRACE_MS

// A reader who just came back reads without touching the page, so idleness counts from the return too.
const idle = (page: PageMoment): boolean => !page.editing && !page.pointerActive && page.now - Math.max(page.lastInputAt, page.visibleSince) >= IDLE_MS

/**
 * Whether an update of these packages may apply now.
 * @param input - the setting, the page moment and the packages the update replaces.
 * @returns true to apply now, false to hold it for the next hidden or idle moment.
 */
const canApply = (input: { readonly mode: ApplyUpdates; readonly page: PageMoment; readonly ids: readonly string[] }): boolean => {
  const page = input.page
  if (!page.connected) return false
  const policy = policyOf(input.mode, page.phone)
  if (policy === 'live' || page.hidden) return true
  const drawsThread = input.ids.some(id => THREAD_PACKAGES.includes(id))
  if (policy === 'live-except-thread' && !resuming(page) && !drawsThread) return true
  // Swapping the thread's own packages remounts it: never in front of a reader, however idle; a window behind
  // another one, or a background tab, still takes it once idle.
  if (drawsThread && page.focused) return false
  return idle(page)
}

/** One code update the page holds: the latest graph replaces an older one, a later rebuild of a package its earlier one. */
export type HeldFrame<Graph> =
  | { readonly type: 'graph'; readonly frame: Graph; readonly ids: readonly string[] }
  | { readonly type: 'rebuilt'; readonly id: string; readonly rev: string }

/** The updates waiting for a hidden or idle moment, in apply order: the graph first, then rebuilds. */
export class HeldUpdates<Graph> {
  private graph: Extract<HeldFrame<Graph>, { type: 'graph' }> | undefined
  private readonly rebuilt = new Map<string, string>()

  add(frame: HeldFrame<Graph>): void {
    if (frame.type === 'graph') {
      this.graph = frame
      return
    }
    this.rebuilt.delete(frame.id)
    this.rebuilt.set(frame.id, frame.rev)
  }

  get size(): number {
    return (this.graph === undefined ? 0 : 1) + this.rebuilt.size
  }

  /** Every package a held update replaces. */
  ids(): readonly string[] {
    return [...new Set([...(this.graph?.ids ?? []), ...this.rebuilt.keys()])]
  }

  /** Hand every held update over in apply order and forget them. */
  take(): readonly HeldFrame<Graph>[] {
    const frames: HeldFrame<Graph>[] = []
    if (this.graph !== undefined) frames.push(this.graph)
    for (const [id, rev] of this.rebuilt) frames.push({ type: 'rebuilt', id, rev })
    this.graph = undefined
    this.rebuilt.clear()
    return frames
  }
}

export class UpdateDeferral {
  static readonly canApply = canApply
}
