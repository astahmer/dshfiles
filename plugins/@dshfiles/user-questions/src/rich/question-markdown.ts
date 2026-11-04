/**
 * Markdown in an `ask_user_question` question: where its heading ends, and which fenced blocks are sandboxed HTML
 * previews rather than code.
 *
 * The question text is the only rich field that survives every path to the form (the live answerer request and the
 * `userQuestions` projection both keep `question` and option `description` verbatim, and strip anything else), so the
 * heading, the body and its previews are all derived from it here.
 */

/** One rendered stretch of the question body. */
export type QuestionSegment =
  | { readonly kind: 'markdown'; readonly text: string }
  | { readonly kind: 'html-preview'; readonly html: string; readonly title: string | undefined }

/** The question split for the form: a one-paragraph heading, then the rest of the markdown. */
export interface QuestionParts {
  /** First paragraph (a leading ATX heading loses its `#`s), or undefined when the text opens with another block. */
  readonly title: string | undefined
  /** Everything after the heading; empty for a one-paragraph question. */
  readonly body: string
}

const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/
const ATX_HEADING = /^ {0,3}#{1,6}[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/
/** A line that starts a block other than a paragraph: fence, image, table, quote, list, rule, raw HTML or indented code. */
const BLOCK_START = /^(?: {0,3}(?:`{3}|~{3}|!\[|\||>|[-*+][ \t]|\d{1,9}[.)][ \t]|(?:[-*_][ \t]*){3,}$|<)| {4}|\t)/
/** Characters or sequences that make the text more than plain prose. */
const MARKDOWN_SYNTAX = /[*_`[\]<>!#|~\\$]|:\/\//

/**
 * Whether the text needs the markdown renderer at all; plain prose keeps the native heading as it always rendered.
 * @param text - Question or option text.
 * @returns True when the text carries markdown syntax or a URL.
 */
function hasMarkdownSyntax(text: string): boolean {
  return MARKDOWN_SYNTAX.test(text)
}

/**
 * Split a question into its heading paragraph and the markdown body under it.
 * @param text - The model's `question` text.
 * @returns The heading (undefined when the text opens with an image, fence, list or other block) and the body.
 */
function questionParts(text: string): QuestionParts {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let start = 0
  while (start < lines.length && (lines[start] ?? '').trim() === '') start += 1
  const first = lines[start]
  if (first === undefined) return { title: undefined, body: '' }
  const heading = ATX_HEADING.exec(first)
  if (heading !== null)
    return {
      title: heading[1] ?? '',
      body: lines
        .slice(start + 1)
        .join('\n')
        .trim(),
    }
  if (BLOCK_START.test(first)) return { title: undefined, body: text.trim() }
  let end = start + 1
  while (end < lines.length && (lines[end] ?? '').trim() !== '' && !BLOCK_START.test(lines[end] ?? '')) end += 1
  return {
    title: lines
      .slice(start, end)
      .map(line => line.trim())
      .join(' '),
    body: lines.slice(end).join('\n').trim(),
  }
}

/**
 * A fence opens an HTML preview when its info string reads `html preview`, optionally followed by a title:
 * ```` ```html preview Revenue by month ````. Any other fence, `html` alone included, stays a code block.
 */
const previewInfo = (info: string): { readonly title: string | undefined } | undefined => {
  const match = /^html[ \t]+preview(?:[ \t]+(.*\S))?[ \t]*$/i.exec(info.trim())
  if (match === null) return undefined
  return { title: match[1] }
}

/**
 * Split a markdown body into prose and sandboxed HTML preview segments, in order.
 *
 * Fences follow CommonMark: a closing fence uses the opening character, at least as many times, and nothing after it.
 * An unclosed preview fence stays markdown (it renders as a code block), so a truncated argument never becomes a page.
 * @param body - Markdown text, usually {@link QuestionParts.body}.
 * @returns Non-empty segments; markdown segments keep their original text, including non-preview fences.
 */
function questionSegments(body: string): readonly QuestionSegment[] {
  const lines = body.replace(/\r\n?/g, '\n').split('\n')
  const segments: QuestionSegment[] = []
  let prose: string[] = []
  const flushProse = (): void => {
    const text = prose.join('\n').trim()
    if (text !== '') segments.push({ kind: 'markdown', text })
    prose = []
  }
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const open = FENCE_OPEN.exec(line)
    if (open === null) {
      prose.push(line)
      index += 1
      continue
    }
    const marker = open[1] ?? '```'
    const info = open[2] ?? ''
    // A backtick fence's info string may not contain a backtick; such a line is inline code, not a fence.
    if (marker.startsWith('`') && info.includes('`')) {
      prose.push(line)
      index += 1
      continue
    }
    const closing = new RegExp(`^ {0,3}${marker[0] === '`' ? '`' : '~'}{${String(marker.length)},}[ \\t]*$`)
    let close = index + 1
    while (close < lines.length && !closing.test(lines[close] ?? '')) close += 1
    const preview = previewInfo(info)
    if (preview === undefined || close >= lines.length) {
      // Copy the whole fence verbatim so a `html preview` line inside a code block is never read as a fence.
      prose.push(...lines.slice(index, Math.min(close + 1, lines.length)))
      index = close + 1
      continue
    }
    flushProse()
    const html = lines.slice(index + 1, close).join('\n')
    if (html.trim() !== '') segments.push({ kind: 'html-preview', html, title: preview.title })
    index = close + 1
  }
  flushProse()
  return segments
}

/**
 * A short plain-text name for a question whose text opens with a block: fences and images dropped, markup stripped.
 * @param text - The model's `question` text.
 * @returns At most 160 characters of prose, or an empty string when the text has none.
 */
function questionPlainText(text: string): string {
  const prose = questionSegments(text)
    .flatMap(segment => (segment.kind === 'markdown' ? [segment.text] : []))
    .join('\n')
    .replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1[ \t]*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[*_`#>|~\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return prose.length > 160 ? `${prose.slice(0, 159)}…` : prose
}

/** Markdown in an `ask_user_question` question: syntax detection, the heading split, preview segments and a plain name. */
export class QuestionMarkdownText {
  static readonly hasSyntax = hasMarkdownSyntax
  static readonly parts = questionParts
  static readonly segments = questionSegments
  static readonly plainText = questionPlainText
}
