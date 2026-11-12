/**
 * Productivity pass Q5 (T5.5): "New project" and "Add folder" were reachable only through the composer's project menu,
 * then a dialog whose "New ▾" button hid New project and Clone repository; users asked agents to do it instead (7
 * threads). This module, published as `@dshfiles/workspace-folder-picker/project-add-flow`, lets any surface (the
 * composer's project menu, the thread list's project picker, ⌘K) open that flow in one call, on the view it names.
 * Importing it loads none of the picker's runtime.
 *
 * - {@link ProjectAddFlow.open} raises the flow: `browse` (Add folder), `create` (New project) or `clone`; it returns
 *   false when no owner is mounted (a profile without @dshfiles/workspace-folder-picker).
 * - {@link ProjectAddFlow.request} only records the view the next directory flow should start on, for an owner that
 *   opens the native flow itself (the composer's project menu).
 *
 * State lives on `globalThis` because every client bundle that imports this module gets its own copy.
 */

export type ProjectAddView = 'browse' | 'create' | 'clone'

const OPEN_EVENT = 'dshfiles-workspace-folder-picker:open-project-add'
const INTENT_TTL_MS = 10_000

declare global {
  // Shared by every bundled copy of this module; see the module comment.
  var __dshfilesProjectAddIntent: { readonly view: ProjectAddView; readonly expiresAt: number } | undefined
  var __dshfilesProjectAddOwners: number | undefined
}

const isView = (value: unknown): value is ProjectAddView => value === 'browse' || value === 'create' || value === 'clone'

export class ProjectAddFlow {
  /** Record the view the next directory flow opens on (consumed by {@link ProjectAddFlow.take}). */
  static request(view: ProjectAddView): void {
    globalThis.__dshfilesProjectAddIntent = { view, expiresAt: Date.now() + INTENT_TTL_MS }
  }

  /** Owner side: the requested view, once; `browse` without a fresh request. */
  static take(): ProjectAddView {
    const intent = globalThis.__dshfilesProjectAddIntent
    globalThis.__dshfilesProjectAddIntent = undefined
    return intent !== undefined && intent.expiresAt > Date.now() ? intent.view : 'browse'
  }

  /**
   * Open the flow on `view` in its own dialog.
   * @returns whether an owner took the request.
   */
  static open(view: ProjectAddView): boolean {
    if (typeof window === 'undefined') return false
    const event = new CustomEvent(OPEN_EVENT, { detail: { view }, cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  }

  /** Whether an owner answers {@link ProjectAddFlow.open} (read when a menu renders; owners mount at boot). */
  static available(): boolean {
    return (globalThis.__dshfilesProjectAddOwners ?? 0) > 0
  }

  /** Owner side: answer {@link ProjectAddFlow.open}; returns the disposer. */
  static handle(handler: (view: ProjectAddView) => void): () => void {
    if (typeof window === 'undefined') return () => undefined
    globalThis.__dshfilesProjectAddOwners = (globalThis.__dshfilesProjectAddOwners ?? 0) + 1
    const listener = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const detail: unknown = event.detail
      const view = typeof detail === 'object' && detail !== null && 'view' in detail ? detail.view : undefined
      if (!isView(view)) return
      event.preventDefault()
      handler(view)
    }
    window.addEventListener(OPEN_EVENT, listener)
    return () => {
      window.removeEventListener(OPEN_EVENT, listener)
      globalThis.__dshfilesProjectAddOwners = Math.max(0, (globalThis.__dshfilesProjectAddOwners ?? 1) - 1)
    }
  }
}
