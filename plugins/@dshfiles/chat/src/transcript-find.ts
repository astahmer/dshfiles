/**
 * Find in thread: the parts that do not render. The Chat window mounts only the rows near the viewport, so browser find
 * misses older messages; the find bar asks the session-search index for every matching event of the whole Session and
 * jumps to the Turn that holds each one.
 */

/** A Chat view that can open its find bar; the `Find in thread` command opens the one the reader is using. */
interface FindTarget {
  readonly frame: () => HTMLElement | null
  readonly open: () => void
}

const targets: FindTarget[] = []

const visible = (element: HTMLElement): boolean => element.isConnected && element.getClientRects().length > 0

/**
 * Register a mounted Chat view. Moving focus or the pointer into it makes it the command's target.
 * @returns unregister.
 */
const register = (target: FindTarget): (() => void) => {
  targets.push(target)
  return () => {
    const index = targets.indexOf(target)
    if (index >= 0) targets.splice(index, 1)
  }
}

const touch = (target: FindTarget): void => {
  const index = targets.indexOf(target)
  if (index < 0 || index === targets.length - 1) return
  targets.splice(index, 1)
  targets.push(target)
}

/**
 * Open the find bar of the Chat view holding focus, else the one last used, else any on screen.
 * @returns false when no Chat view is on screen, so the key goes on to the browser.
 */
const open = (): boolean => {
  const active = typeof document === 'undefined' ? null : document.activeElement
  const onScreen = targets.filter(target => {
    const frame = target.frame()
    return frame !== null && visible(frame)
  })
  const focused = active === null ? undefined : onScreen.find(target => target.frame()?.contains(active) === true)
  const chosen = focused ?? onScreen.at(-1)
  if (chosen === undefined) return false
  chosen.open()
  return true
}

/**
 * The Turn that holds an event: the last Turn whose first event is at or before it.
 * @param starts - first event seq of each Turn, ascending by seq.
 * @returns the Turn number, or undefined for an event before the first Turn.
 */
const turnOf = (starts: readonly { readonly turn: number; readonly seq: number }[], seq: number): number | undefined => {
  let low = 0
  let high = starts.length - 1
  let found: number | undefined
  while (low <= high) {
    const middle = (low + high) >> 1
    const start = starts[middle]
    if (start === undefined) break
    if (start.seq <= seq) {
      found = start.turn
      low = middle + 1
    } else high = middle - 1
  }
  return found
}

/** Step through `count` matches, wrapping at both ends. */
const step = (input: { readonly index: number; readonly count: number; readonly direction: 1 | -1 }): number =>
  input.count === 0 ? 0 : (input.index + input.direction + input.count) % input.count

const MATCH_LABELS = new Map<string, string>([
  ['user/message', 'Message'],
  ['assistant/message', 'Reply'],
  ['tool/call', 'Tool call'],
  ['tool/result', 'Tool output'],
  ['todo/write', 'Todos'],
  ['turn/end', 'Turn end'],
])

/** Short name of the event kind a match is in, shown beside its snippet. */
const matchLabel = (type: string): string => MATCH_LABELS.get(type) ?? 'Event'

/** The words a reader typed, lowercased, for marking them in the rows on screen. */
const findWords = (text: string): readonly string[] =>
  text
    .toLowerCase()
    .split(/\s+/u)
    .filter(word => /[\p{L}\p{N}]/u.test(word))

/** CSS highlight name the find bar registers; ChatView.module.css styles it. */
const HIGHLIGHT_NAME = 'dshfiles-chat-find'

/**
 * Text ranges of every word inside the given rows, for the CSS Custom Highlight API: it marks text without touching
 * the transcript's DOM, so a streamed or re-rendered row never carries a stale mark.
 */
const wordRanges = (rows: readonly Element[], words: readonly string[]): Range[] => {
  const ranges: Range[] = []
  if (words.length === 0) return ranges
  for (const row of rows) {
    const walker = row.ownerDocument.createTreeWalker(row, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
      const text = node.textContent?.toLowerCase() ?? ''
      if (text.length === 0 || node.parentElement?.closest('[hidden]') !== null) continue
      for (const word of words) {
        for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + word.length)) {
          const range = row.ownerDocument.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + word.length)
          ranges.push(range)
        }
      }
    }
  }
  return ranges.sort((left, right) => left.compareBoundaryPoints(Range.START_TO_START, right))
}

export class TranscriptFind {
  static readonly register = register
  static readonly touch = touch
  static readonly open = open
  static readonly turnOf = turnOf
  static readonly step = step
  static readonly matchLabel = matchLabel
  static readonly findWords = findWords
  static readonly wordRanges = wordRanges
  static readonly highlightName = HIGHLIGHT_NAME
  /** The `Find in thread` command; the shortcuts plugin binds its keys. */
  static readonly commandId = 'dshfiles-chat.find-in-thread'
  static readonly keys: readonly string[] = ['Mod+F']
}
