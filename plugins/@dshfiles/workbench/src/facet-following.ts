/** The follow/rebind/settle lifecycle of the facet pages a lost thread left on screen. */
/** Where one kept page stands. */
type PageState =
  /** Kept in place while another thread is on screen; its own thread's page is not asked for. */
  | { readonly kind: 'following' }
  /** The on-screen thread's page of the same kind was asked for `threadId`, so each thread is asked once. */
  | { readonly kind: 'asked'; readonly threadId: string }

/** What a kept page needs from the Workbench and the native owner. */
export interface FacetFollowPorts {
  /** The thread the Workbench shows, absent while no thread is on screen. */
  readonly onScreen: () => string | undefined
  /** The native thread of a page, read while its registration stands. */
  readonly threadOf: (id: string) => string | undefined
  /** The native kind of a page, read while its registration stands. */
  readonly kindOf: (id: string) => string | undefined
  /** Whether the page's record still follows the on-screen thread. */
  readonly follows: (id: string) => boolean
  /** Whether the page still has a panel in a region. */
  readonly placed: (id: string) => boolean
  /** Whether the native owner lists the page again. */
  readonly listed: (id: string) => boolean
  /** Ask the native owner for the on-screen thread's page of this kind. */
  readonly openPage: (kind: string) => boolean
  /** Give the page's place up: close its panels and dispose its registration. */
  readonly release: (id: string) => void
}

/** Delay before a kept page whose replacement never arrived gives its place up. */
const SETTLE_DELAY_MS = 2_000

/**
 * Pages of a thread that left the screen, kept in place until the on-screen thread's page of the same kind replaces
 * them. One page state per page id; the rebind runs as a queued microtask after a sync (the native store publishes on
 * its own schedule) and the settle runs as one delayed transition from the newest rebind.
 */
export class FacetFollowing {
  readonly #pages = new Map<string, PageState>()
  readonly #ports: FacetFollowPorts
  #rebindQueued = false
  #settleTimer: ReturnType<typeof setTimeout> | undefined

  /** @param ports - the on-screen thread, the page records, and the one release. */
  constructor(ports: FacetFollowPorts) {
    this.#ports = ports
  }

  /** Reconcile one page the native owner no longer lists: keep it while its thread is off screen, else give it up. */
  drop(id: string): void {
    if (this.#ports.follows(id) && this.#ports.onScreen() !== this.#ports.threadOf(id) && this.#ports.placed(id)) {
      this.#keep(id)
      return
    }
    this.#giveUp(id)
  }

  /** Forget a page whose place another page took: it is replaced, not released. */
  forget(id: string): void {
    this.#pages.delete(id)
  }

  /** Ask once for the on-screen thread's page of every kept kind, after the projections of a sync settled. */
  scheduleRebind(): void {
    if (this.#pages.size === 0 || this.#rebindQueued || this.#ports.onScreen() === undefined) return
    this.#rebindQueued = true
    queueMicrotask(() => {
      this.#rebind()
    })
  }

  /** Drop every kept page and the pending settle; nothing is released here, the owner disposes its registrations. */
  dispose(): void {
    if (this.#settleTimer !== undefined) clearTimeout(this.#settleTimer)
    this.#settleTimer = undefined
    this.#pages.clear()
  }

  #keep(id: string): void {
    if (this.#pages.has(id)) return
    this.#pages.set(id, { kind: 'following' })
  }

  #giveUp(id: string): void {
    this.#pages.delete(id)
    this.#ports.release(id)
  }

  #rebind(): void {
    this.#rebindQueued = false
    const onScreen = this.#ports.onScreen()
    // No thread on screen (a new-thread draft, a destination page): the facet keeps its place and its last thread's
    // body until a thread comes on screen, which runs `sync` again.
    if (onScreen === undefined) return
    for (const [id, state] of [...this.#pages]) {
      const thread = this.#ports.threadOf(id)
      if (thread === undefined || !this.#ports.placed(id)) {
        this.#pages.delete(id)
        continue
      }
      if ((state.kind === 'asked' && state.threadId === onScreen) || thread === onScreen) continue
      this.#pages.set(id, { kind: 'asked', threadId: onScreen })
      const kind = this.#ports.kindOf(id)
      // The on-screen thread's page of this kind arrives through `sync`, possibly after this call returns; `sync`
      // then puts it in this page's place.
      if (kind === undefined || !this.#ports.openPage(kind)) {
        this.#pages.delete(id)
        this.#ports.release(id)
      }
    }
    this.#armSettle()
  }

  #armSettle(): void {
    if (this.#pages.size === 0 || this.#settleTimer !== undefined) return
    this.#settleTimer = setTimeout(() => {
      this.#settle()
    }, SETTLE_DELAY_MS)
  }

  #settle(): void {
    this.#settleTimer = undefined
    const onScreen = this.#ports.onScreen()
    for (const id of [...this.#pages.keys()]) {
      const thread = this.#ports.threadOf(id)
      if (thread === undefined || !this.#ports.placed(id) || this.#ports.listed(id)) {
        this.#pages.delete(id)
        continue
      }
      // While no thread is on screen the page stays: it still stands for the last thread it showed.
      if (onScreen === undefined || thread === onScreen) continue
      this.#giveUp(id)
    }
  }
}
