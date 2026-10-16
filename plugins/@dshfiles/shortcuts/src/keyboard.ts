/**
 * Capture-phase keyboard shortcuts.
 *
 * The Host's own shortcut runtime listens for `keydown` in the bubble phase, so a
 * chord the browser also claims — `primary+p` for print — has already done its
 * browser-level work by the time dispatch runs. A bubble listener cannot take
 * those chords back; a capture listener runs before the event reaches the target
 * and can, which is why this exists as a plugin rather than as configuration.
 *
 * It also covers the runtime's native-input path. That path skips DOM dispatch
 * entirely on macOS and Windows, expecting an Electron shell to forward
 * `before-input-event`. In a browser there is no such shell, so the registry is
 * inert there — which is why `primary+k` does nothing on the web profile today.
 *
 * Two rules keep this from being hostile:
 *
 * - A chord is only claimed when the focused element is not editable. Typing
 *   `Cmd+P` inside a textarea should insert those characters, not open a panel.
 * - A chord already handled by someone else is left alone. DSH's own registry runs
 *   first for anything it owns, and this only claims what nothing else took.
 */

/** `primary` is Meta on macOS and Control everywhere else, matching the Host. */
export type Modifier = 'primary' | 'control' | 'alt' | 'shift' | 'meta'

export interface Shortcut {
  /** Stable id, so a binding can be referred to by name rather than by chord. */
  readonly id: string
  readonly key: string
  readonly modifier: Modifier
  /** Extra modifier that must also be held, for chords like `primary+shift+p`. */
  readonly alsoShift?: boolean
  /**
   * Whether the chord still applies when a text field has focus.
   *
   * The composer is a textarea and holds focus almost all the time, so a chord
   * guarded against editable targets would never fire in practice. Plain letter
   * chords still need the guard — those are the ones that would insert text — but
   * a modified chord cannot type anything, so it is safe to claim anywhere.
   */
  readonly allowInEditable?: boolean
  /** Human label for menus and help. */
  readonly label: string
  readonly run: (event: KeyboardEvent) => void
}

const EDITABLE_SELECTOR =
  'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'

/** Resolve the Host's logical `primary` to the physical modifier for this platform. */
const isPrimaryHeld = (event: KeyboardEvent, mac: boolean): boolean => (mac ? event.metaKey : event.ctrlKey)

/**
 * Count how many modifiers the event carries, ignoring the one the chord claims.
 *
 * A keydown reports every modifier that is down, so a chord that only checked for
 * its own would also fire on `alt+cmd+p` and quietly steal a sequence the Host
 * might own. Requiring the set to match exactly is what makes the chords
 * predictable enough to document.
 */
const extraModifiers = (event: KeyboardEvent, mac: boolean): number =>
  (event.ctrlKey ? 1 : 0) + (event.metaKey ? 1 : 0) + (event.altKey ? 1 : 0) + (event.shiftKey ? 1 : 0) - (isPrimaryHeld(event, mac) ? 1 : 0)

export class ShortcutKeyboardModel {
  static readonly isMacPlatform = (platform: string): boolean => platform === 'MacIntel' || platform === 'macOS' || platform.startsWith('Mac')

  /** Whether the event landed somewhere that consumes plain character keys. */
  static readonly isEditableTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof Element)) return false
    if (target.matches(EDITABLE_SELECTOR)) return true
    // A shortcut pressed while a dialog is open belongs to the dialog.
    return target.closest(EDITABLE_SELECTOR) !== null
  }

  /**
   * Whether this event is exactly this chord.
   *
   * "Exactly" matters: a chord that also matched `primary+shift+p` would fire both,
   * because a keydown carries every modifier that is down.
   */
  static readonly matchesShortcut = (event: KeyboardEvent, shortcut: Shortcut, mac: boolean): boolean => {
    if (event.code !== shortcut.key && event.key !== shortcut.key) return false
    if (!isPrimaryHeld(event, mac)) return false
    // Exactly one extra modifier is allowed, and only when the chord asks for it.
    const extra = extraModifiers(event, mac)
    return shortcut.alsoShift === true ? extra === 1 && event.shiftKey : extra === 0
  }
}

/**
 * Install one capture-phase listener for the given shortcuts.
 *
 * Capture is the whole point: it runs before the target's own handlers, so
 * claiming a browser chord here is possible at all. The listener is passive about
 * anything it does not own and calls nothing when no binding matches.
 */
export const installShortcuts = (target: Window, shortcuts: readonly Shortcut[]): (() => void) => {
  const mac = ShortcutKeyboardModel.isMacPlatform(target.navigator.platform)

  const onKeyDown = (event: KeyboardEvent): void => {
    // Someone already handled it, a composition is in flight, or the key is being
    // auto-repeated: none of these are a fresh command.
    if (event.defaultPrevented || event.isComposing || event.repeat) return
    // A modified chord cannot insert text, so it is claimed even from a text
    // field. Without this the guard below would swallow every chord aimed at the
    // composer, which is where focus actually is.
    const inEditable = ShortcutKeyboardModel.isEditableTarget(event.composedPath().find(node => node instanceof Element) ?? null)
    for (const shortcut of shortcuts) {
      if (!ShortcutKeyboardModel.matchesShortcut(event, shortcut, mac)) continue
      if (inEditable && shortcut.allowInEditable !== true) continue

      // Both calls are needed: preventDefault stops the browser's own binding,
      // stopPropagation keeps the Host's runtime from also dispatching it.
      event.preventDefault()
      event.stopPropagation()
      shortcut.run(event)
      return
    }
  }

  target.addEventListener('keydown', onKeyDown, true)
  return () => {
    target.removeEventListener('keydown', onKeyDown, true)
  }
}
