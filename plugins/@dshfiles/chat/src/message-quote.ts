// Quote a conversation message (or the part of it the user selected) into the
// composer draft as an editable Markdown blockquote. Pure text work lives here;
// MessageIconActions owns the button and the composer write.

/** Where a quote came from, rendered as the line under the blockquote. */
export interface QuoteSource {
  /** Who wrote the quoted text, already localized ("You", "Assistant"). */
  readonly author: string
  /** Turn number of the quoted message, when it has one. */
  readonly turn?: number | undefined
  /** Clock label of the quoted message, already formatted. */
  readonly clock?: string | undefined
}

/** Localized pieces of the source line. */
export interface QuoteSourceLabels {
  /** e.g. `turn {turn}`. */
  readonly turn: (turn: number) => string
}

export class MessageQuote {
  /**
   * Turn quoted text into blockquote lines: one `> ` per line, line breaks kept, blank lines inside the quote kept
   * as a bare `>` so the blockquote stays one block, and an existing `>` nested one level deeper.
   * Leading and trailing blank lines are dropped; undefined when nothing but whitespace is left.
   */
  static blockquote(text: string): string | undefined {
    const lines = text
      .replace(/\r\n?/gu, '\n')
      .split('\n')
      .map(line => line.trimEnd())
    while (lines.length > 0 && lines[0] === '') lines.shift()
    while (lines.length > 0 && lines.at(-1) === '') lines.pop()
    if (lines.length === 0) return undefined
    return lines.map(line => (line === '' ? '>' : line.startsWith('>') ? `>${line}` : `> ${line}`)).join('\n')
  }

  /** The attribution line under the quote, e.g. `— Assistant · turn 3 · 14:05`. */
  static sourceLine(source: QuoteSource, labels: QuoteSourceLabels): string {
    const parts = [source.author]
    if (source.turn !== undefined) parts.push(labels.turn(source.turn))
    if (source.clock !== undefined && source.clock !== '') parts.push(source.clock)
    return `— ${parts.join(' · ')}`
  }

  /**
   * The full block inserted into the draft: the blockquote, its source line, then an empty line so the caret lands
   * on a fresh line for the reply. Undefined when the text is empty.
   */
  static format(text: string, source: QuoteSource, labels: QuoteSourceLabels): string | undefined {
    const quote = MessageQuote.blockquote(text)
    if (quote === undefined) return undefined
    return `${quote}\n${MessageQuote.sourceLine(source, labels)}\n\n`
  }

  /**
   * Prefix needed so an inserted quote starts on its own paragraph: nothing at the start of an empty draft or after
   * a blank line, one newline after a line break, two after text.
   */
  static separatorBefore(draftBeforeCaret: string): string {
    if (draftBeforeCaret === '' || draftBeforeCaret.endsWith('\n\n')) return ''
    return draftBeforeCaret.endsWith('\n') ? '\n' : '\n\n'
  }
}

/** A DOM range the quote may take its text from, limited to the quoted message. */
export interface QuoteSelectionScope {
  /** Whether a node belongs to the quoted message. */
  contains(node: Node): boolean
}

/**
 * Text the user selected inside the quoted message, or undefined when the selection is empty or reaches outside it.
 * @param selection - the document selection at the moment the Quote action was pressed.
 * @param scope - which nodes belong to the message.
 */
export const selectedQuoteText = (selection: Selection | null, scope: QuoteSelectionScope): string | undefined => {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return undefined
  const { anchorNode, focusNode } = selection
  if (anchorNode === null || focusNode === null || !scope.contains(anchorNode) || !scope.contains(focusNode)) return undefined
  const text = selection.toString()
  return text.trim() === '' ? undefined : text
}

const SEAT = '[data-chat-flow-kind]'
const elementOf = (node: Node): Element | null => (node.nodeType === 1 ? (node as Element) : node.parentElement)

/**
 * The scope of the message an actions row belongs to.
 * A user row's actions sit inside that message's own seat. An assistant reply's actions sit in the turn tail, so its
 * message is every assistant-step seat of the same turn.
 */
export const quoteScopeFor = (actions: Element, kind: 'row' | 'turn-assistant'): QuoteSelectionScope => {
  const seat = actions.closest(SEAT)
  if (kind === 'row') return { contains: node => seat !== null && elementOf(node)?.closest(SEAT) === seat }
  const turn = seat?.getAttribute('data-chat-turn') ?? null
  return {
    contains: node => {
      const owner = elementOf(node)?.closest(SEAT)
      return (
        turn !== null &&
        owner !== null &&
        owner !== undefined &&
        owner.getAttribute('data-chat-flow-kind') === 'assistant-step' &&
        owner.getAttribute('data-chat-turn') === turn
      )
    },
  }
}
