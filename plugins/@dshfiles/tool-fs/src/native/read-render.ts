/**
 * Pure read presentation: turn provider-decoded text into a bounded, line-numbered window and
 * model-facing envelope. Chunk scanning caps the current line, so even one newline-free giant
 * line cannot grow memory without bound.
 * @module @deepseek-ai/dsh-tool-fs/read-render
 */

/** Default maximum characters returned for a single line (the `readMaxLineLength` config). */
export const READ_MAX_LINE_LENGTH = 2000

/** Default maximum bytes returned for selected file lines (the `readMaxBytes` config). */
export const READ_MAX_BYTES = 50 * 1024

/** Lines an offset past the end of the file still returns, from the end, beside the line count. */
export const PAST_END_LINES = 50

/** Resolved read window. The consumer applies its defaults/caps before calling. */
export interface ReadWindow {
  /** 1-based first line to return. */
  offset: number
  /** Return the last `fromEnd` lines (at most `limit`) instead of a window from `offset`. */
  fromEnd?: number
  /** Maximum number of lines to return. */
  limit: number
  /** Maximum characters returned for a single line; overflow is truncated with a suffix. */
  maxLineLength: number
  /** Maximum bytes of selected output; overflow stops the scan and marks `truncatedByBytes`. */
  maxBytes: number
}

/** One line returned from a text file. */
export interface FileTextLine {
  /** 1-based line number in the file. */
  number: number
  /** Line text without its trailing newline. */
  text: string
}

/** The windowed result {@link buildWindow} produces from a file's decoded text. */
export interface WindowResult {
  /** 1-based number of the first returned line (the requested offset unless reading from the end). */
  offset: number
  /** Whether the requested offset was past the end, so the lines are the file's last ones. */
  pastEnd: boolean
  /** Returned lines, already numbered. */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  totalLines: number
  /** Whether selected output hit the byte cap. */
  truncatedByBytes: boolean
}

/** Outcome of a bounded text read — what {@link formatReadOutput} renders. */
export interface FileReadOutcome {
  /** 1-based first line requested. */
  offset: number
  /** Returned lines, already numbered. */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  totalLines: number
  /** Whether selected output hit the byte cap. */
  truncatedByBytes?: true
  /** The requested offset when it was past the end and the lines are the file's last ones. */
  pastEndOffset?: number
}

interface WindowAccumulator {
  lines: FileTextLine[]
  totalLines: number
  outputBytes: number
  truncatedByBytes: boolean
  /** The most recent lines (already shortened), kept while reading from the end or before reaching `offset`. */
  tail: string[]
}

function newAccumulator(): WindowAccumulator {
  return { lines: [], totalLines: 0, outputBytes: 0, truncatedByBytes: false, tail: [] }
}

function truncateLine(line: string, maxLineLength: number): string {
  if (line.length <= maxLineLength) return line
  // Never keep half of a surrogate pair: an astral character spans two UTF-16 units.
  const lastKept = line.charCodeAt(maxLineLength - 1)
  const end = lastKept >= 0xd800 && lastKept <= 0xdbff ? maxLineLength - 1 : maxLineLength
  return `${line.substring(0, end)}... (line truncated to ${maxLineLength} chars)`
}

function tailSize(request: ReadWindow): number {
  return Math.min(request.fromEnd ?? PAST_END_LINES, request.limit)
}

function rememberTail(acc: WindowAccumulator, rawLine: string, request: ReadWindow): void {
  const size = tailSize(request)
  acc.tail.push(truncateLine(rawLine, request.maxLineLength))
  if (acc.tail.length > size * 2) acc.tail.splice(0, acc.tail.length - size)
}

function lineByteSize(line: string, currentLineCount: number): number {
  return Buffer.byteLength(line, 'utf8') + (currentLineCount > 0 ? 1 : 0)
}

function consumeLine(acc: WindowAccumulator, rawLine: string, request: ReadWindow): void {
  acc.totalLines += 1
  if (request.fromEnd !== undefined || acc.totalLines < request.offset) {
    rememberTail(acc, rawLine, request)
    return
  }
  if (acc.tail.length > 0) acc.tail = []
  if (acc.truncatedByBytes || acc.lines.length >= request.limit) return

  const text = truncateLine(rawLine, request.maxLineLength)
  const bytes = lineByteSize(text, acc.lines.length)
  if (acc.outputBytes + bytes > request.maxBytes) {
    acc.truncatedByBytes = true
    return
  }
  acc.outputBytes += bytes
  acc.lines.push({ number: acc.totalLines, text })
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line
}

/** The file's last lines within the byte cap, dropping the earliest ones first. */
function finishFromEnd(acc: WindowAccumulator, request: ReadWindow, pastEnd: boolean): WindowResult {
  const kept = acc.tail.slice(-tailSize(request))
  const texts: string[] = []
  let bytes = 0
  for (const text of kept.toReversed()) {
    const size = lineByteSize(text, texts.length)
    if (bytes + size > request.maxBytes) break
    bytes += size
    texts.unshift(text)
  }
  const first = acc.totalLines - texts.length + 1
  return {
    offset: texts.length === 0 ? 1 : first,
    pastEnd,
    lines: texts.map((text, index) => ({ number: first + index, text })),
    totalLines: acc.totalLines,
    truncatedByBytes: false,
  }
}

function finish(acc: WindowAccumulator, request: ReadWindow): WindowResult {
  if (request.fromEnd !== undefined) return finishFromEnd(acc, request, false)
  if (request.offset > acc.totalLines && !(acc.totalLines === 0 && request.offset === 1)) return finishFromEnd(acc, request, true)
  return { offset: request.offset, pastEnd: false, lines: acc.lines, totalLines: acc.totalLines, truncatedByBytes: acc.truncatedByBytes }
}

/**
 * Build one window from streamed or whole-file chunks, enforcing line and byte caps while still
 * scanning to an exact total line count. `fromEnd`, or an offset past EOF, returns the file's last lines.
 * @param chunks - decoded text chunks in file order; chunk boundaries carry no meaning.
 * @param request - the resolved window; the caller has already applied its defaults and caps.
 * @returns the numbered window lines, the total line count seen, and the byte-cap truncation flag.
 */
export async function buildWindow(
  chunks: AsyncIterable<string> | Iterable<string>,
  request: ReadWindow,
): Promise<WindowResult> {
  const acc = newAccumulator()
  // One char past the truncation point is enough to prove a line overflows.
  const lineBufferCap = request.maxLineLength + 1
  let lineBuffer = ''

  function appendToLineBuffer(segment: string): void {
    if (lineBuffer.length >= lineBufferCap) return
    lineBuffer += segment
    if (lineBuffer.length > lineBufferCap) lineBuffer = lineBuffer.slice(0, lineBufferCap)
  }

  function flushLine(): void {
    consumeLine(acc, stripCarriageReturn(lineBuffer), request)
    lineBuffer = ''
  }

  for await (const chunk of chunks) {
    let startPos = 0
    let newlinePos: number
    while ((newlinePos = chunk.indexOf('\n', startPos)) !== -1) {
      appendToLineBuffer(chunk.slice(startPos, newlinePos))
      flushLine()
      startPos = newlinePos + 1
    }
    appendToLineBuffer(chunk.slice(startPos))
  }
  if (lineBuffer.length > 0) flushLine()
  return finish(acc, request)
}

/**
 * Format a read outcome as one OpenCode-style line-numbered text block body.
 * @param displayPath - the backend-resolved path rendered in the envelope's `<path>` element.
 * @param outcome - the windowed read to render.
 * @returns the model-facing envelope: numbered lines plus a continuation or end-of-file footer.
 */
export function formatReadOutput(displayPath: string, outcome: FileReadOutcome): string {
  const endLine = outcome.lines.at(-1)?.number ?? Math.max(0, outcome.offset - 1)
  let footer: string
  if (outcome.truncatedByBytes) {
    footer = `(Output capped. Showing lines ${outcome.offset}-${endLine}. Use offset=${endLine + 1} to continue.)`
  } else if (endLine < outcome.totalLines) {
    footer = `(Showing lines ${outcome.offset}-${endLine} of ${outcome.totalLines}. Use offset=${endLine + 1} to continue.)`
  } else {
    footer = `(End of file - total ${outcome.totalLines} lines)`
  }
  const pastEnd = outcome.pastEndOffset === undefined
    ? ''
    : `(Offset ${outcome.pastEndOffset} is past the end of the file (${outcome.totalLines} lines); showing the last ${outcome.lines.length} lines.)\n\n`
  const body = outcome.lines.length > 0
    ? `${pastEnd}${outcome.lines.map(line => `${line.number}: ${line.text}`).join('\n')}\n\n${footer}`
    : `${pastEnd}${footer}`
  return `<path>${displayPath}</path>
<type>file</type>
<content>
${body}
</content>`
}

/**
 * Derive the persisted `lang` hint from a read path's file extension. The shared
 * table in `@deepseek-ai/dsh-util-code-language` owns the recognized suffixes and
 * the path rules (both separators, a leading dot as the extension separator, and
 * prototype-key safety); `readLangHintForPath` projects the read card's short ids
 * over it, so a suffix whose value a recorded session already holds keeps it
 * byte-identical while every other suffix uses its language's short name.
 * @param path - the model-facing path the read reported.
 * @returns the persisted language hint, or `undefined` when the extension maps to none.
 */
export { readLangHintForPath as langFromPath } from '@deepseek-ai/dsh-util-code-language'

/**
 * The `read` tool's private `tool/result` `meta` payload: the structured
 * line-numbered window a capable UI renders as a code view. Attached opaquely (as
 * `unknown`) on the tool result and persisted with the session log — it must be
 * JSON-serializable (the session validates this at `append`), so `presentResult`
 * reproduces the read card on replay when the raw structured output is no longer
 * on the wire. The producing tool owns and narrows this opaque shape.
 */
export interface FsReadMeta {
  /** The read file's model-facing path. */
  path: string
  /** The 1-based first line the window requested, kept even when `lines` is empty. */
  offset: number
  /** The returned window's lines, each keeping its file line number. */
  lines: FileTextLine[]
  /** Exact total line count in the file. */
  totalLines: number
  /** Syntax-highlighting language hint from the extension, or omitted for plain text. */
  lang?: string
}

/**
 * Whether `value` is a valid {@link FileTextLine} (defensive narrowing from
 * opaque `meta`). `number` must be a 1-based integer line number, since a card
 * rendered from a zero, fractional, or non-finite line number would violate the
 * 1-based numbering contract the read window promises.
 */
function isFileTextLine(value: unknown): value is FileTextLine {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const { number, text } = value as Record<string, unknown>
  return typeof number === 'number' && Number.isInteger(number) && number >= 1 && typeof text === 'string'
}

/**
 * Narrow opaque live or replayed result metadata to a structured read window.
 * Malformed metadata returns `undefined` so presentation can fall back to the
 * generic text card instead of throwing during replay. Beyond shape, the
 * semantic contract of a read window is enforced against replayed JSON that is
 * well-typed but out of range: `offset` must be a 1-based integer, `totalLines`
 * must be a non-negative integer, each line number must be a 1-based integer no
 * less than `offset`, the line numbers must strictly increase, and no line number
 * may exceed `totalLines`. Any violation declines to the generic fallback rather
 * than emitting a card that misnumbers or overcounts.
 * @param meta - result metadata.
 * @returns the validated read window, or `undefined` for absent, malformed, or semantically invalid data.
 */
export function readMetaFromMeta(meta: unknown): FsReadMeta | undefined {
  if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) return undefined
  const { path, offset, lines, totalLines, lang } = meta as Record<string, unknown>
  if (typeof path !== 'string' || typeof totalLines !== 'number' || typeof offset !== 'number') return undefined
  if (!Number.isInteger(offset) || offset < 1) return undefined
  if (!Number.isInteger(totalLines) || totalLines < 0) return undefined
  if (!Array.isArray(lines) || !lines.every(isFileTextLine)) return undefined
  if (lang !== undefined && typeof lang !== 'string') return undefined
  let previous = offset - 1
  for (const { number } of lines) {
    if (number <= previous || number > totalLines) return undefined
    previous = number
  }
  return { path, offset, lines, totalLines, ...lang === undefined ? {} : { lang } }
}
