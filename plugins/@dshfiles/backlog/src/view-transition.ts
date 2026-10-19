import { flushSync } from 'react-dom'

/**
 * Runs a state change inside a same-document View Transition, so cards carrying a `view-transition-name` glide to
 * their new column or layout instead of jumping. Falls back to a plain update without the API or with reduced motion.
 */
export const withViewTransition = (update: () => void): void => {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduced || !('startViewTransition' in document)) {
    update()
    return
  }
  document.startViewTransition(() => flushSync(update))
}
