import { PHONE_SHELL_QUERY } from '@dshfiles/plugin-ui/lib/phone-shell'
import { useSyncExternalStore } from 'react'

const subscribe = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(PHONE_SHELL_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

const read = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_SHELL_QUERY).matches

/** Whether the page shows the phone shell (the kit's rule), following a resize or rotation. */
export const usePhoneShell = (): boolean => useSyncExternalStore(subscribe, read, () => false)
