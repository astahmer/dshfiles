import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient } from '@dshfiles/dshx/client'
import { installShortcuts, type Shortcut } from './keyboard.js'

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
    document.documentElement.dataset['dshfilesShortcuts'] = 'setup-ran'
    const layout = ctx.get('layout')
    const shortcuts: Shortcut[] = [
      {
        id: 'shortcuts.toggleSidebar',
        key: 'KeyB',
        modifier: 'primary',
        label: 'Toggle sidebar',
        run: () => {
          layout?.toggleSidebar()
        },
      },
      {
        id: 'shortcuts.newSession',
        key: 'KeyN',
        modifier: 'primary',
        label: 'New session',
        run: () => {
          // Selecting the conversation panel is the closest the layout service
          // comes to "start something new"; the composer takes it from there.
          layout?.selectPanel(null)
        },
      },
      {
        id: 'shortcuts.search',
        key: 'KeyP',
        modifier: 'primary',
        label: 'Search',
        run: () => {
          focusComposer()
        },
      },
      {
        id: 'shortcuts.commandPalette',
        key: 'KeyK',
        modifier: 'primary',
        label: 'Command palette',
        run: () => {
          focusComposer()
        },
      },
      {
        id: 'shortcuts.settings',
        key: 'Comma',
        modifier: 'primary',
        label: 'Settings',
        run: () => {
          layout?.selectPanel(null)
        },
      },
    ]

    ctx.effect(() => installShortcuts(window, shortcuts), 'shortcuts: keyboard')
  },
})

/**
 * Put the caret in the composer.
 *
 * The composer is the surface every search-like command wants, so the two chords
 * that differ only in name land in the same place rather than opening a panel the
 * Host does not expose to a plugin.
 */
const focusComposer = (): void => {
  const composer = document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
    'textarea:not([disabled]), input[type="text"]:not([disabled])',
  )
  if (composer === null) return
  composer.focus()
  composer.setSelectionRange(composer.value.length, composer.value.length)
}