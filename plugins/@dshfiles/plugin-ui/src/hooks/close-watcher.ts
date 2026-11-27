import { useEffect, useRef } from 'react'

/**
 * The subset of the CloseWatcher API this hook drives. Chrome 126+ (and every Android Chrome this app targets)
 * routes the back gesture and Escape to the most recently created watcher, so a transient layer can close with the
 * system back gesture instead of leaving the page. TypeScript's DOM lib does not describe it yet.
 */
interface CloseWatcherLike {
  oncancel: ((event: Event) => void) | null
  destroy: () => void
}

type CloseWatcherConstructor = new () => CloseWatcherLike

const globalWithWatcher = (): typeof globalThis & { readonly CloseWatcher?: CloseWatcherConstructor } => globalThis

/** Whether this browser can close a layer with the system back gesture (`CloseWatcher`). */
export const closeWatcherAvailable = (): boolean => globalWithWatcher().CloseWatcher !== undefined

/**
 * Keep one transient layer (picker, popover, dialog) on the system back gesture while `open`: the back gesture or
 * Escape cancels the watcher, and `onClose` closes the layer once. Browsers without `CloseWatcher` keep their own
 * Escape handling; a caller that needs Back there has to use the phone history layer instead.
 */
export const useCloseWatcher = (open: boolean, onClose: () => void): void => {
  const latest = useRef(onClose)
  latest.current = onClose
  useEffect(() => {
    if (!open) return
    const Constructor = globalWithWatcher().CloseWatcher
    if (Constructor === undefined) return
    const watcher = new Constructor()
    watcher.oncancel = event => {
      event.preventDefault()
      latest.current()
    }
    return () => {
      watcher.destroy()
    }
  }, [open])
}
