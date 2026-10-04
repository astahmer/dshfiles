import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { installShortcuts, type Shortcut } from './keyboard.js'

/**
 * The layout service surface this plugin drives.
 *
 * `ILayout` is taken from the Host package rather than restated here: `selectPanel`
 * takes the branded `MainPanelId`, so a hand-written `(panelId: string | null)`
 * widens the parameter and the assignment no longer typechecks.
 */
type Layout = ILayout

/**
 * Keyboard shortcuts that actually take effect.
 *
 * The Host's shortcut runtime listens in the bubble phase, and on macOS and
 * Windows it skips DOM dispatch entirely in favour of native input that only an
 * Electron shell provides. Neither path can claim a chord the browser also owns,
 * which is why `primary+p` prints instead of searching. This installs one
 * capture-phase listener, which runs first and can.
 *
 * It is a plugin rather than desktop-only code so the same chords work in the
 * browser, in an installed PWA, and in the desktop shell.
 */
export default defineClient({
  name: '@dshfiles/shortcuts',
  setup(ctx) {
    // Resolved per key press rather than once at setup. The layout service is
    // registered by another client entry, so reading it during setup can observe
    // an empty context — and `layout?.toggleSidebar()` then no-ops behind optional
    // chaining, which looks exactly like a swallowed chord: claimed, prevented, and
    // silently inert. Looking it up when the chord fires cannot be too early.
    const layout = (): Layout | undefined => ctx.get('layout')
    const shortcuts: Shortcut[] = [
      {
        id: 'shortcuts.toggleSidebar',
        key: 'KeyB',
        modifier: 'primary',
        allowInEditable: true,
        label: 'Toggle sidebar',
        run: () => {
          requireLayout(layout).toggleSidebar()
        },
      },
      {
        id: 'shortcuts.newSession',
        key: 'KeyN',
        modifier: 'primary',
        allowInEditable: true,
        label: 'New session',
        run: () => {
          // Selecting the conversation panel is the closest the layout service
          // comes to "start something new"; the composer takes it from there.
          requireLayout(layout).selectPanel(null)
        },
      },
      {
        id: 'shortcuts.commandPalette',
        key: 'KeyK',
        modifier: 'primary',
        allowInEditable: true,
        label: 'Focus composer',
        run: () => {
          focusComposer()
        },
      },
      {
        id: 'shortcuts.settings',
        key: 'Comma',
        modifier: 'primary',
        allowInEditable: true,
        label: 'Settings',
        run: () => {
          requireLayout(layout).selectPanel(null)
        },
      },
    ]

    ctx.effect(() => installShortcuts(window, shortcuts), 'shortcuts: keyboard')
  },
})

/**
 * The layout service, or a loud failure.
 *
 * Optional chaining here would turn a missing service into a chord that is
 * claimed and then silently does nothing — the exact symptom that made Cmd+B look
 * broken while the matcher was fine. Throwing names the cause instead.
 */
const requireLayout = (resolve: () => Layout | undefined): Layout => {
  const layout = resolve()
  if (layout === undefined) {
    throw new Error(
      'shortcuts: the layout service is unavailable, so this chord cannot act. The sidebar and panel shortcuts need @deepseek-ai/dsh-client-ui-layout mounted.',
    )
  }
  return layout
}

/**
 * Put the caret in the composer.
 *
 * It is matched by role rather than by tag: the Host renders the composer as a
 * `contenteditable` div and ships no textarea at all, so a `textarea` query finds
 * nothing and the chord appears to do nothing.
 */
const focusComposer = (): void => {
  const composer = document.querySelector<HTMLElement>(
    '[role="textbox"]:not([aria-disabled="true"]), textarea:not([disabled])',
  )
  if (composer === null) return
  composer.focus()
  // A text field has a caret to place; a contenteditable div has a selection.
  if (composer instanceof HTMLInputElement || composer instanceof HTMLTextAreaElement) {
    composer.setSelectionRange(composer.value.length, composer.value.length)
    return
  }
  const range = document.createRange()
  range.selectNodeContents(composer)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}
