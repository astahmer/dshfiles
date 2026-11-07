import type { CommandItem } from '@dshfiles/dshx/client'

/**
 * The bottom-panel toggle, contributed as a command rather than as one more Host
 * shortcut row.
 *
 * The browser owns `primary+J` for its Downloads panel, and the Host refuses a
 * Web binding it cannot deliver, so the chord arrives through the capture-phase
 * listener in `@dshfiles/shortcuts` instead. A contributed command is what that
 * listener binds, and `editable` is what lets Settings › Shortcuts rebind it:
 * the effective keys follow the user's binding once one exists.
 */
export const BOTTOM_PANEL_COMMAND_ID = '@dshfiles/workbench.toggleBottomPanel'

/** `Cmd+J` on macOS, `Ctrl+J` everywhere else. */
export const BOTTOM_PANEL_CHORD = 'Mod+J'

/** The terminal reads this chord as a line feed (`Ctrl+J`), so it keeps the key while xterm owns the keyboard. */
export const bottomPanelCommand = (input: { readonly title: string; readonly toggle: () => void }): CommandItem => ({
  id: BOTTOM_PANEL_COMMAND_ID,
  title: input.title,
  keywords: ['workbench', 'dock', 'panel', 'bottom panel', 'terminal'],
  keys: [BOTTOM_PANEL_CHORD],
  editable: true,
  allowInTerminal: false,
  run: input.toggle,
})
