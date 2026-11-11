/** The excerpt action that appears only while the terminal holds a selection. */
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TerminalExcerpt } from './excerpt.ts'

/** Copy and state the terminal screen supplies for its one excerpt action. */
export interface TerminalExcerptActionProps {
  /** The current selection, or undefined when the terminal has none. */
  readonly excerpt: TerminalExcerpt | undefined
  /** Attach the excerpt to the thread that owns the terminal. */
  readonly attach: (excerpt: TerminalExcerpt) => void
  /** A previous attach returned false for this selection. */
  readonly failed: boolean
  readonly label: string
  readonly failedLabel: string
  readonly styles: Record<string, string>
}

/**
 * Render the excerpt action over the terminal screen.
 * @param props - the selection, its attach command and localized copy.
 * @returns the action while something is selected, otherwise nothing.
 */
export function TerminalExcerptAction({ excerpt, attach, failed, label, failedLabel, styles }: TerminalExcerptActionProps): ReactNode {
  if (excerpt === undefined) return null
  return (
    <div className={styles.excerptAction}>
      {/* Keeping focus in the terminal holds its selection while the click lands. */}
      <Button variant="outline" size="sm" onMouseDown={event => { event.preventDefault() }} onClick={() => { attach(excerpt) }}>{label}</Button>
      {failed && <p className={styles.excerptFailed} role="alert">{failedLabel}</p>}
    </div>
  )
}
