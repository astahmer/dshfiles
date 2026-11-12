/**
 * The thread's secondary views (Trajectory, Traces, Requests…) as thread-panel facets, published as the
 * `@dshfiles/rich-composer/thread-views` dshx module. Importing it loads none of the composer's runtime.
 *
 * Productivity pass Q5 (E5): the stage always shows Chat; every other `conversation.view` opens as a facet of the
 * thread panel instead of a tab in the thread header. This module is how another plugin learns which views exist and
 * opens one (the header `⋯` in thread-sidebar does both), without a dependency on Rich Composer's runtime.
 *
 * - {@link ThreadViewsModel.list} / {@link ThreadViewsModel.subscribe}: the registered non-Chat views, in tab order.
 * - {@link ThreadViewsModel.open}: ask the owner to open one view of one thread in the thread panel; returns whether
 *   an owner took the request (false in a profile without Rich Composer or without a thread panel).
 *
 * The registry lives on `globalThis` because every client bundle that imports this module gets its own copy.
 */

/** One secondary view of a thread. */
export interface ThreadView {
  /** The `conversation.view` id (`trajectory`, `dshfiles-traces`, `dshfiles-traces-requests`…). */
  readonly id: string
  /** Its label in the current language. */
  readonly label: string
}

export interface ThreadViewOpenRequest {
  readonly sessionId: string
  readonly viewId: string
}

const OPEN_EVENT = 'dshfiles-conversation:open-thread-view'
const CHANGED_EVENT = 'dshfiles-conversation:thread-views-changed'
const FACET_PREFIX = 'dshfiles-thread-view.'

interface Registry {
  views: readonly ThreadView[]
  /** How many thread-panel owners host the views as facets; with none, the header keeps its view switch. */
  hosts?: number
}

declare global {
  // Shared by every bundled copy of this module; see the module comment.
  var __dshfilesConversationThreadViews: Registry | undefined
}

const registry = (): Registry => {
  globalThis.__dshfilesConversationThreadViews ??= { views: [] }
  return globalThis.__dshfilesConversationThreadViews
}

const same = (left: readonly ThreadView[], right: readonly ThreadView[]): boolean =>
  left.length === right.length && left.every((view, index) => view.id === right[index]?.id && view.label === right[index]?.label)

const isOpenRequest = (value: unknown): value is ThreadViewOpenRequest =>
  typeof value === 'object' &&
  value !== null &&
  'sessionId' in value &&
  'viewId' in value &&
  typeof value.sessionId === 'string' &&
  typeof value.viewId === 'string' &&
  value.sessionId.length > 0 &&
  value.viewId.length > 0

export class ThreadViewsModel {
  /** The thread-panel page kind a view opens as. */
  static facetKind(viewId: string): string {
    return `${FACET_PREFIX}${viewId.replace(/[^a-zA-Z0-9._-]/gu, '-')}`
  }

  /** The registered secondary views, in tab order; empty without Rich Composer. */
  static list(): readonly ThreadView[] {
    return registry().views
  }

  /** Whether a thread panel hosts the views as facets (a profile with the right pane), so the stage stays Chat. */
  static hosted(): boolean {
    return (registry().hosts ?? 0) > 0
  }

  /** Owner side: a thread panel starts hosting the views; returns the release. */
  static host(): () => void {
    const current = registry()
    current.hosts = (current.hosts ?? 0) + 1
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
    let released = false
    return () => {
      if (released) return
      released = true
      current.hosts = Math.max(0, (current.hosts ?? 1) - 1)
      if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
    }
  }

  static subscribe(listener: () => void): () => void {
    if (typeof window === 'undefined') return () => undefined
    window.addEventListener(CHANGED_EVENT, listener)
    return () => window.removeEventListener(CHANGED_EVENT, listener)
  }

  /** Owner side: replace the published views (Rich Composer, whenever its `conversation.view` ledger changes). */
  static publish(views: readonly ThreadView[]): void {
    const current = registry()
    if (same(current.views, views)) return
    current.views = views
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(CHANGED_EVENT))
  }

  /**
   * Open one view of one thread in its thread panel.
   * @returns whether an owner took the request.
   */
  static open(request: ThreadViewOpenRequest): boolean {
    if (typeof window === 'undefined') return false
    const event = new CustomEvent(OPEN_EVENT, { detail: request, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  /** Owner side: handle open requests; the handler returns whether it took the request. */
  static handle(handler: (request: ThreadViewOpenRequest) => boolean): () => void {
    if (typeof window === 'undefined') return () => undefined
    const listener = (event: Event): void => {
      if (!(event instanceof CustomEvent) || !isOpenRequest(event.detail)) return
      if (handler(event.detail)) event.preventDefault()
    }
    window.addEventListener(OPEN_EVENT, listener)
    return () => window.removeEventListener(OPEN_EVENT, listener)
  }
}
