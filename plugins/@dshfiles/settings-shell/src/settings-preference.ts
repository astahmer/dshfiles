import { z } from 'zod'
import type { ShellSurface } from './shell-machine.js'

const openInSchema = z.object({ openIn: z.enum(['auto', 'tab', 'modal']).catch('auto') }).catch({ openIn: 'auto' })

/**
 * Where Settings opens: the user's `openIn`, where `auto` means a tab exactly when main-tabs gives the main view tabs.
 * An unserved or malformed namespace reads as `auto`, so an older Host keeps the dialog.
 */
export const preferredSurface = (input: { readonly settings: unknown; readonly tabsLoaded: boolean }): ShellSurface => {
  const openIn = openInSchema.parse(input.settings).openIn
  if (openIn === 'auto') return input.tabsLoaded ? 'tab' : 'modal'
  return openIn
}
