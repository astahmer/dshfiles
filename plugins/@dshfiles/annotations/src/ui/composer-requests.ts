/**
 * "Point at UI…" from the composer's More menu or `/annotate` (composer redesign b:v9yh): the request reaches the
 * annotations tool mounted in that thread's composer, which opens its own popover. The tool stays mounted either way;
 * only its permanent button left the conversation bar.
 */
const listeners = new Map<string, Set<() => void>>()

export const annotationsRequests = {
  open(scope: string): void {
    for (const listener of listeners.get(scope) ?? []) listener()
  },
  on(scope: string, listener: () => void): () => void {
    const set = listeners.get(scope) ?? new Set()
    set.add(listener)
    listeners.set(scope, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(scope)
    }
  },
}

/**
 * Whether the tool shows its own button. Outside the conversation composer (Backlog's text boxes) it always does. In
 * the conversation bar it does while the user keeps composer extras pinned, while annotations are open (a count chip),
 * and while it is working (its popover is open or a pick is running), so the pick can always be finished or cancelled.
 */
export const showsAnnotationsButton = (input: {
  readonly surface: string
  readonly inMoreMenu: boolean
  readonly count: number
  readonly working: boolean
}): boolean => input.surface !== 'conversation' || !input.inMoreMenu || input.count > 0 || input.working
