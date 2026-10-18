/**
 * Document text handling for the owned index. The extraction itself stays core's (`buildSessionEventSearchDocuments`),
 * so what gets indexed matches the stock backend; this module only bounds how much of each document is stored, which
 * is what keeps giant tool payloads from dominating the index.
 */

/** The reserved noncharacters FTS5's `snippet()` markers use; documents must not contain them literally. */
const MARKER_START = '\uFDD0'
const MARKER_END = '\uFDD1'

export interface TruncatedText {
  readonly text: string
  readonly truncated: boolean
}

export interface MarkedText {
  readonly text: string
  readonly matchStart: number
}

/**
 * Per-event-type caps in Unicode code points. Measured on this corpus: one 49.5 MB log decodes to 157 MB of events and
 * that volume is tool traffic, so conversation text keeps a large cap while tool payloads keep enough of their head to
 * stay findable. The untruncated text stays in the session log, which remains the source of truth.
 */
const DOCUMENT_CAPS = new Map<string, number>([
  ['user/message', 65_536],
  ['assistant/message', 65_536],
  ['tool/call', 8_192],
  ['tool/result', 8_192],
  ['todo/write', 4_096],
  ['turn/end', 1_024],
])

const DEFAULT_CAP = 4_096

export class DocumentText {
  static capFor(type: string): number {
    return DOCUMENT_CAPS.get(type) ?? DEFAULT_CAP
  }

  static sanitize(text: string): string {
    return text.replaceAll('\0', '\uFFFD').replaceAll(MARKER_START, '\uFFFD').replaceAll(MARKER_END, '\uFFFD')
  }

  /** Cap by code points so a multi-byte character is never split in half. */
  static truncate(text: string, maxChars: number): TruncatedText {
    if (maxChars <= 0) return { text: '', truncated: text.length > 0 }
    const characters = Array.from(text)
    if (characters.length <= maxChars) return { text, truncated: false }
    return { text: characters.slice(0, maxChars).join(''), truncated: true }
  }

  private static normalizeMarked(markedText: string): MarkedText {
    const characters: string[] = []
    let matchStart: number | undefined
    for (const character of markedText) {
      if (character === MARKER_START) {
        matchStart ??= characters.length
        continue
      }
      if (character === MARKER_END) continue
      if (/\s/u.test(character)) {
        if (characters.length > 0 && characters.at(-1) !== ' ') characters.push(' ')
      } else characters.push(character)
    }
    if (characters.at(-1) === ' ') characters.pop()
    return { text: characters.join(''), matchStart: matchStart ?? 0 }
  }

  /** One bounded excerpt around the match, mirroring the stock backend's plain-text snippet. */
  static snippet(markedText: string, maxChars: number): string {
    const { text, matchStart } = DocumentText.normalizeMarked(markedText)
    const characters = Array.from(text)
    if (characters.length <= maxChars) return text
    if (maxChars <= 1) return '…'
    const matchedIndex = Math.min(matchStart, characters.length - 1)
    const contentLength = Math.max(1, maxChars - 2)
    const start = Math.max(0, Math.min(matchedIndex - Math.floor(contentLength / 3), characters.length - contentLength))
    const prefix = start > 0 ? '…' : ''
    const suffix = start + contentLength < characters.length ? '…' : ''
    return `${prefix}${characters.slice(start, start + contentLength).join('')}${suffix}`
  }
}
