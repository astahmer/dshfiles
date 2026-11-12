/** Terminal glyph for sidebar tab titles. */
import type { ReactNode } from 'react'
import { TerminalIcon as LucideTerminal } from '@dshfiles/plugin-ui/icons'

/**
 * Render the tab title's terminal prompt in the surrounding text color.
 * dshfiles: lucide's terminal glyph (the one icon family), at the 14px row size with the 1.5 stroke.
 * @returns a decorative line glyph.
 */
export function TerminalIcon(): ReactNode {
  return <LucideTerminal aria-hidden size={14} strokeWidth={1.5} />
}
