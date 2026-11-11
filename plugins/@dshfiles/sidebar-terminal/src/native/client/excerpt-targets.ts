/** One mounted terminal screen that can hand its current selection to the composer. */
export interface TerminalExcerptTarget {
  /** Whether a shortcut's event target belongs to this terminal. */
  readonly contains: (node: Node | null) => boolean
  /** Whether this terminal currently holds a printable selection. */
  readonly selected: () => boolean
  /** Attach this terminal's selection, reporting failure in the terminal's own UI. */
  readonly attach: () => void
}

const targets = new Set<TerminalExcerptTarget>()

/**
 * Register one mounted terminal screen.
 * @param target - the screen's selection and attach commands.
 * @returns the release callback to run on unmount.
 */
export const registerTerminalExcerptTarget = (target: TerminalExcerptTarget): (() => void) => {
  targets.add(target)
  return () => {
    targets.delete(target)
  }
}

/**
 * The mounted terminal that owns a shortcut's event target.
 * @param node - the keyboard event target, or null.
 * @returns its screen, when one is mounted there.
 */
export const terminalExcerptTargetAt = (node: Node | null): TerminalExcerptTarget | undefined => {
  for (const target of targets) if (target.contains(node)) return target
  return undefined
}
