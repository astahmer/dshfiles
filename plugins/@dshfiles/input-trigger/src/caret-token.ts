/**
 * Cursor-neighborhood resolution for sigil-prefixed completions, ported from
 * Codex (`codex-rs/tui/src/bottom_pane/chat_composer/completion_target.rs`,
 * Apache-2.0). A token is one whitespace-delimited run; the caret targets the
 * token it touches on either side of same-line separator whitespace, and line
 * breaks never give affinity. Chips (U+FFFC in a rich composer's detect text)
 * are atomic boundaries inside a token.
 */

/** One prefixed token around the caret: `[start, end)` covers the sigil and the whole token. */
export interface CaretToken {
  readonly start: number
  readonly end: number
  /** The token text after the sigil, including any part right of the caret. */
  readonly query: string
}

const ATOMIC_CHAR = '\uFFFC'
const WHITESPACE = /\s/u
const LINE_BREAK = /[\n\r\v\f\u0085\u2028\u2029]/u

const isWhitespace = (char: string | undefined): boolean => char !== undefined && WHITESPACE.test(char)
const isHorizontalWhitespace = (char: string | undefined): boolean => isWhitespace(char) && !LINE_BREAK.test(char ?? '')

const candidateIn = (input: {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly anchor: number
  readonly prefix: string
  readonly allowEmpty: boolean
}): CaretToken | null => {
  const anchor = Math.min(Math.max(input.anchor, input.start), input.end)
  let segmentStart = input.start
  let segmentEnd = input.end
  let hasAtomicBoundary = false
  for (let index = input.start; index < input.end; index++) {
    if (input.text.charAt(index) !== ATOMIC_CHAR) continue
    hasAtomicBoundary = true
    if (index + 1 <= anchor) {
      segmentStart = index + 1
      continue
    }
    if (anchor <= index) segmentEnd = index
    else segmentStart = segmentEnd = anchor
    break
  }
  const segment = input.text.slice(segmentStart, segmentEnd)
  if (!segment.startsWith(input.prefix)) return null
  const query = segment.slice(input.prefix.length)
  if (hasAtomicBoundary && !input.allowEmpty && query === '') return null
  return { start: segmentStart, end: segmentEnd, query }
}

/**
 * The `prefix` token the caret is on, if any.
 * @returns the token range and its query, or null when the caret targets no prefixed token.
 */
export const prefixedTokenAt = (input: {
  readonly text: string
  readonly caret: number
  readonly prefix: '@' | '#'
  /** Whether a bare sigil (empty query) counts; Codex's mention popup allows it. Defaults to true. */
  readonly allowEmpty?: boolean
}): CaretToken | null => {
  const { text, prefix } = input
  const allowEmpty = input.allowEmpty ?? true
  const caret = Math.min(Math.max(input.caret, 0), text.length)
  const before = text.slice(0, caret)
  const after = text.slice(caret)

  const atWhitespace = isWhitespace(after.charAt(0) || undefined)
  const afterHorizontalWhitespace = isHorizontalWhitespace(before.at(-1))
  const cursorStartsToken = afterHorizontalWhitespace && !atWhitespace
  const nextNonSeparator = [...after].find(char => !isHorizontalWhitespace(char))
  const separatorPrecedesToken = nextNonSeparator !== undefined && !isWhitespace(nextNonSeparator)
  const separatorPrecedesCompletion = nextNonSeparator === '@' || nextNonSeparator === '$'
  const atSeparator = (atWhitespace || afterHorizontalWhitespace) && separatorPrecedesToken

  const firstWhitespaceFrom = (from: number): number => {
    for (let index = from; index < text.length; index++) if (isWhitespace(text.charAt(index))) return index
    return text.length
  }
  const lastWhitespaceBefore = (end: number): number => {
    for (let index = end - 1; index >= 0; index--) if (isWhitespace(text.charAt(index))) return index + 1
    return 0
  }

  let endLeft = firstWhitespaceFrom(caret)
  if (atSeparator) {
    endLeft = caret
    while (endLeft > 0 && isHorizontalWhitespace(text.charAt(endLeft - 1))) endLeft--
  }
  const startLeft = lastWhitespaceBefore(endLeft)
  let startRight = caret
  while (startRight < text.length && isHorizontalWhitespace(text.charAt(startRight))) startRight++
  const endRight = firstWhitespaceFrom(startRight)

  const left = candidateIn({ text, start: startLeft, end: endLeft, anchor: caret, prefix, allowEmpty })
  const right = candidateIn({ text, start: startRight, end: endRight, anchor: startRight, prefix, allowEmpty })

  if (cursorStartsToken) return right
  if (allowEmpty && after.startsWith(prefix) && text.slice(startLeft, caret) === prefix) return { start: startLeft, end: caret, query: '' }
  if (atSeparator) {
    if (afterHorizontalWhitespace && !separatorPrecedesCompletion) return right
    if (prefix === '@' && right !== null) return right
    if (left?.query === '' && !allowEmpty) return right
    return left ?? right
  }
  if (after.startsWith(prefix)) {
    const prefixStartsToken = before === '' || isWhitespace(before.at(-1))
    return prefixStartsToken ? (right ?? left) : left
  }
  return left ?? right
}
