import { PHONE_SHELL_QUERY } from '@dshfiles/plugin-ui/lib/phone-shell'

/**
 * The phone shell's media rule, in one place: the shell switches layout on it and a thread menu reads it to leave out
 * what needs a second pane. It is the kit's rule (under 640px wide, or a coarse pointer under 500px tall), so a phone
 * turned sideways keeps the tab bar instead of the desktop rail.
 */
export const PHONE_QUERY = PHONE_SHELL_QUERY

const subscribe = (listener: () => void): (() => void) => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

const matches = (): boolean => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches

export class PhoneLayout {
  static readonly subscribe = subscribe
  static readonly matches = matches
}
