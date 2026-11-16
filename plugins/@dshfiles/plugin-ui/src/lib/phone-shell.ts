/**
 * The phone shell's media rule, in one place: a viewport under 640px, or a coarse pointer whose short side is under
 * 500px (a phone turned sideways, 844x390, would otherwise get the desktop rail and tab strip). Width alone keys
 * portrait; the height clause keys landscape without catching a tablet. Stylesheets cannot import it, so each CSS
 * rule spells the same list: `@media (max-width: 639.98px), (pointer: coarse) and (max-height: 500px)`.
 */
export const PHONE_SHELL_QUERY = '(max-width: 639.98px), (pointer: coarse) and (max-height: 500px)'

/** True when the phone shell's media rule matches in `view` (false without `matchMedia`, as on a server render). */
export const matchesPhoneShell = (view: Pick<Window, 'matchMedia'> | undefined = typeof window === 'undefined' ? undefined : window): boolean =>
  view !== undefined && typeof view.matchMedia === 'function' && view.matchMedia(PHONE_SHELL_QUERY).matches
