/** One terminal selection on its way to the composer: bounded text and the terminal's 1-based line range. */
export interface TerminalExcerpt {
  readonly text: string
  readonly label: string
}

/** Longest excerpt kept whole; a longer selection keeps its head and ends with an ellipsis. */
export const MAX_EXCERPT_CHARS = 4000

/** The terminal model surface one selection needs; xterm satisfies it. */
export interface TerminalSelectionSource {
  hasSelection(): boolean
  getSelection(): string
  getSelectionPosition():
    | {
        readonly start: { readonly x: number; readonly y: number }
        readonly end: { readonly x: number; readonly y: number }
      }
    | undefined
}

const trimTrailingWhitespace = (text: string): string => text.replace(/[ \t]+$/gmu, '').trimEnd()

const bound = (text: string): string => {
  if (text.length <= MAX_EXCERPT_CHARS) return text
  const head = text.slice(0, MAX_EXCERPT_CHARS - 1)
  // Never leave half a surrogate pair, which would render as a replacement glyph.
  const whole = /[\uD800-\uDBFF]$/u.test(head) ? head.slice(0, -1) : head
  return `${whole}…`
}

/** `Terminal 12` for one line, `Terminal 12-14` for a range; both are 1-based buffer lines. */
export const excerptLabel = (firstLine: number, lastLine: number): string =>
  firstLine === lastLine ? `Terminal ${String(firstLine)}` : `Terminal ${String(firstLine)}-${String(lastLine)}`

/** Build the excerpt for a known line range, or undefined when nothing printable is selected. */
export const excerptOfLines = (lines: {
  readonly text: string
  readonly firstLine: number
  readonly lastLine: number
}): TerminalExcerpt | undefined => {
  const text = bound(trimTrailingWhitespace(lines.text))
  if (text === '') return undefined
  return { text, label: excerptLabel(lines.firstLine, lines.lastLine) }
}

/** A selection on the last visible row ends at column 0 of the next row; that row is not part of it. */
const lastSelectedLine = (position: NonNullable<ReturnType<TerminalSelectionSource['getSelectionPosition']>>): number =>
  position.end.x === 0 && position.end.y > position.start.y ? position.end.y - 1 : position.end.y

/** The terminal's current selection as an excerpt, or undefined while it has none. */
export const excerptOf = (source: TerminalSelectionSource): TerminalExcerpt | undefined => {
  if (!source.hasSelection()) return undefined
  const position = source.getSelectionPosition()
  if (position === undefined) return undefined
  return excerptOfLines({ text: source.getSelection(), firstLine: position.start.y + 1, lastLine: lastSelectedLine(position) + 1 })
}
