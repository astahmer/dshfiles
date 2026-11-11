/**
 * The composers that can open their prompt history. Ctrl+R inside a composer opens its own; the palette entry opens the
 * focused one, else the last one used, else any on screen.
 */
/** What a focused element is compared by; a DOM `Node` satisfies it. */
interface FocusNode {
  readonly nodeType: number
}

/** The DOM members a composer card is checked by; an `Element` satisfies it. */
interface Frame {
  readonly isConnected: boolean
  getClientRects(): ArrayLike<unknown>
  contains(other: FocusNode | null): boolean
}

interface HistoryTarget {
  /** The composer card this Prompts action sits in. */
  readonly frame: () => Frame | null
  readonly open: () => void
}

const targets: HistoryTarget[] = []

const onScreen = (element: Frame): boolean => element.isConnected && element.getClientRects().length > 0

/** @returns unregister. */
const register = (target: HistoryTarget): (() => void) => {
  targets.push(target)
  return () => {
    const index = targets.indexOf(target)
    if (index >= 0) targets.splice(index, 1)
  }
}

/** Mark a composer as the last one used, so the palette entry opens it. */
const touch = (target: HistoryTarget): void => {
  const index = targets.indexOf(target)
  if (index < 0 || index === targets.length - 1) return
  targets.splice(index, 1)
  targets.push(target)
}

/**
 * Open one composer's history.
 * @param input.focusedOnly - only a composer holding focus qualifies (the Ctrl+R key).
 * @returns false when no composer qualifies, so a key press goes on to the browser.
 */
const open = (input: { readonly focusedOnly: boolean; readonly active: FocusNode | null }): boolean => {
  const visible = targets.filter(target => {
    const frame = target.frame()
    return frame !== null && onScreen(frame)
  })
  const active = input.active
  const focused = active === null ? undefined : visible.find(target => target.frame()?.contains(active) === true)
  const chosen = input.focusedOnly ? focused : (focused ?? visible.at(-1))
  if (chosen === undefined) return false
  chosen.open()
  return true
}

/** Ctrl+R with no other modifier: Cmd+R on a Mac stays the browser's reload. */
const isHistoryKey = (event: {
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}): boolean => event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'r'

export class PromptHistoryTargets {
  static readonly isHistoryKey = isHistoryKey
  static readonly register = register
  static readonly touch = touch
  static readonly open = open
  static readonly paletteCommandId = '@dshfiles/prompt-stash.history'
}
