import { useEffect, useState } from 'react'
import { views } from './panel-preferences.js'

const modifierKeys = new Set(['Meta', 'Control'])

/** The view a digit shortcut opens, in tab order; only the tab bar's own digits count. */
export const viewForShortcut = (key: string): (typeof views)[number] | undefined => views[Number(key) - 1]

/**
 * Whether the primary shortcut modifier is held right now. The tab bar shows its digits while it is down, so they
 * disappear again on release, on a lost focus, and when the window is hidden.
 */
export const usePrimaryModifierHeld = (): boolean => {
  const [held, setHeld] = useState(false)
  useEffect(() => {
    const press = (event: KeyboardEvent): void => {
      if (modifierKeys.has(event.key)) setHeld(true)
    }
    const release = (event: KeyboardEvent): void => {
      if (modifierKeys.has(event.key)) setHeld(false)
    }
    const reset = (): void => setHeld(false)
    window.addEventListener('keydown', press)
    window.addEventListener('keyup', release)
    window.addEventListener('blur', reset)
    document.addEventListener('visibilitychange', reset)
    return () => {
      window.removeEventListener('keydown', press)
      window.removeEventListener('keyup', release)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', reset)
    }
  }, [])
  return held
}
