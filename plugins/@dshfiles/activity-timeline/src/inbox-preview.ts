/**
 * Plain-text previews of what a provider wrote. A question is Markdown (a link, a table, a fenced chart), and an Inbox
 * row is two lines: it shows the words of the first paragraph and leaves the rest to the thread.
 */

const FENCE_OPEN = /^(.*?)(?:`{3,}|~{3,})[^`]*$/u
const FENCE_CLOSE = /^\s*(?:`{3,}|~{3,})\s*$/u
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/u
/** An element that only makes sense as its own block; a line that opens with one is markup, not prose. */
const HTML_BLOCK =
  /^\s*<(?:!--|\/?(?:style|script|div|p|table|thead|tbody|tr|td|th|pre|iframe|svg|details|summary|section|article|ul|ol|li|h[1-6]|hr|br|img|video|figure|blockquote)\b)/iu
const RAW_TEXT_OPEN = /<(style|script)\b/iu

const ESCAPED = /\\([\\`*_{}[\]()#+\-.!~|>])/gu
/** Escaped markers wait in the Unicode private use area, which no question text uses. */
const ESCAPE_BASE = 0xe000
const PARKED = /[\ue000-\ue07f]/gu

/** Lines of prose only: fenced code, HTML blocks and tables become a paragraph break. */
const proseLines = (source: string): readonly string[] => {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n')
  const kept: string[] = []
  let fenced = false
  let rawText: string | null = null
  let table = false
  for (const [index, line] of lines.entries()) {
    if (fenced) {
      if (FENCE_CLOSE.test(line)) fenced = false
      continue
    }
    if (rawText !== null) {
      if (line.toLowerCase().includes(`</${rawText}`)) rawText = null
      continue
    }
    const fence = FENCE_OPEN.exec(line)
    if (fence !== null) {
      // A clamped question can end inside its fence: everything after the opening is code either way.
      fenced = true
      kept.push(fence[1] ?? '', '')
      continue
    }
    if (HTML_BLOCK.test(line)) {
      const raw = RAW_TEXT_OPEN.exec(line)?.[1]?.toLowerCase()
      if (raw !== undefined && !line.toLowerCase().includes(`</${raw}`)) rawText = raw
      kept.push('')
      continue
    }
    const next = lines[index + 1]
    const piped = line.includes('|')
    const tableHead = piped && next !== undefined && next.includes('|') && TABLE_SEPARATOR.test(next)
    // A table runs from its head to the next blank line; its rows need no leading pipe.
    table = piped && (table || tableHead || line.trimStart().startsWith('|'))
    kept.push(table ? '' : line)
  }
  return kept
}

/** One paragraph's words: Markdown markers, inline HTML and link targets removed. */
const inlineText = (paragraph: string): string =>
  paragraph
    // An escaped marker is a literal character: park it until the markers around it are gone.
    .replace(ESCAPED, (_match, character: string) => String.fromCodePoint(ESCAPE_BASE + (character.codePointAt(0) ?? 0)))
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gmu, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\[[^\]]*\]/gu, '$1')
    .replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/gu, '$1')
    .replace(/<\/?[a-z][^>]*>/giu, '')
    .replace(/(`+)([^`]+)\1/gu, '$2')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/gu, '$2')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/gu, '$1')
    .replace(/(?<![\w*])\*(?=\S)([^*]+?)(?<=\S)\*(?![\w*])/gu, '$1')
    .replace(/(?<![\w_])_(?=\S)([^_]+?)(?<=\S)_(?![\w_])/gu, '$1')
    .replace(PARKED, character => String.fromCodePoint((character.codePointAt(0) ?? ESCAPE_BASE) - ESCAPE_BASE))
    .replace(/\s+/gu, ' ')
    .trim()

const paragraphsOf = (source: string): readonly string[] =>
  proseLines(source)
    .join('\n')
    .split(/\n\s*\n/u)
    .map(inlineText)
    .filter(paragraph => paragraph.length > 0)

/** The first paragraph as plain words; empty when the text holds no prose (only a table, a fence or markup). */
const firstParagraph = (source: string): string => paragraphsOf(source)[0] ?? ''

/** Every paragraph as plain words on one line, for a detail the row clamps itself. */
const flat = (source: string): string => paragraphsOf(source).join(' ')

export const InboxPreview = { firstParagraph, flat } as const
