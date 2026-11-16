/**
 * The phone shell's width rule, in one place: the shell switches layout on it and a thread menu reads it to leave out
 * what needs a second pane.
 */
export const PHONE_QUERY = '(max-width: 639.98px)'

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
